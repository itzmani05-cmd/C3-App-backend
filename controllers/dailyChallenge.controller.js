const mongoose = require('mongoose');
const DailyChallenge = require('../models/DailyChallenge');
const DailyChallengeAttempt = require('../models/DailyChallengeAttempt');
const DailyChallengeProgress = require('../models/DailyChallengeProgress');
const Topic = require('../models/Topic');
const User = require('../models/User');
const {
  MAX_ATTEMPTS,
  REQUIRED_QUESTION_COUNT,
  AttemptLimitError,
  stripForAttempt,
  revealForAttempt,
  getHardExpiryMs,
  computeRevealState,
  consumeAttemptSlot,
  scoreAgainstSnapshot,
  maybeCreateReminders,
  computeStreak,
  computeStreaksForUsers,
} = require('../utils/dailyChallengeHelpers');

const LEADERBOARD_LIMIT = 50;

function getRequestUserId(req) {
  return req.userId || req.headers.userid;
}

// Builds the question payload + attempt info returned to the student, honoring reveal state.
function buildChallengeView(challenge, progress, latestAttempt, currentStreak) {
  const revealState = computeRevealState(challenge, progress);

  const responseByQuestionId = new Map();
  if (revealState.revealed && latestAttempt?.responses) {
    latestAttempt.responses.forEach((r) => {
      responseByQuestionId.set(String(r.questionId), r.selectedOptionIndex);
    });
  }

  const questions = challenge.questionSnapshot.map((q) => {
    if (revealState.revealed) {
      return revealForAttempt(q, responseByQuestionId.get(String(q.questionId)));
    }
    return stripForAttempt(q);
  });

  return {
    challengeId: challenge._id,
    title: challenge.title,
    questionCount: challenge.questionSnapshot.length,
    publishedAt: challenge.publishedAt,
    expiresAt: challenge.expiresAt,
    maxAttempts: MAX_ATTEMPTS,
    attemptsSubmitted: revealState.attemptsSubmitted,
    attemptsRemaining: revealState.attemptsRemaining,
    bestScore: progress?.bestScore ?? null,
    bestPercentage: progress?.bestPercentage ?? null,
    currentStreak: currentStreak ?? 0,
    revealed: revealState.revealed,
    revealReason: revealState.reason,
    questions,
  };
}

exports.getToday = async (req, res) => {
  try {
    const userId = getRequestUserId(req);
    if (!userId) return res.status(401).json({ message: 'User not authenticated' });

    const challenge = await DailyChallenge.findOne({ status: 'published' })
      .sort({ publishedAt: -1 })
      .lean();

    if (!challenge) {
      return res.json({ challenge: null });
    }

    const progress = await DailyChallengeProgress.findOne({
      challengeId: challenge._id,
      userId,
    }).lean();

    let latestAttempt = null;
    const revealState = computeRevealState(challenge, progress);
    if (revealState.revealed) {
      latestAttempt = await DailyChallengeAttempt.findOne({
        challengeId: challenge._id,
        userId,
        isSubmitted: true,
        isVoid: { $ne: true },
      })
        .sort({ attemptNumber: -1 })
        .lean();
    }

    const { currentStreak } = await computeStreak(userId);

    // Reminder generation also happens lazily here (as a side effect of the student checking in),
    // in addition to the proactive sweep job — both are dedup-guarded, so this is always safe.
    const requester = await User.findById(userId).select('expoPushToken').lean();
    maybeCreateReminders(challenge, userId, revealState, requester?.expoPushToken).catch((err) =>
      console.error('Reminder creation error:', err)
    );

    res.json({ challenge: buildChallengeView(challenge, progress, latestAttempt, currentStreak) });
  } catch (err) {
    console.error('GET TODAY DAILY CHALLENGE ERROR:', err);
    res.status(500).json({ message: 'Error fetching daily challenge' });
  }
};

exports.startAttempt = async (req, res) => {
  try {
    const userId = getRequestUserId(req);
    if (!userId) return res.status(401).json({ message: 'User not authenticated' });

    const { challengeId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(challengeId)) {
      return res.status(400).json({ message: 'Invalid challenge id' });
    }

    const challenge = await DailyChallenge.findOne({ _id: challengeId, status: 'published' }).lean();
    if (!challenge) {
      return res.status(404).json({ message: 'Daily challenge not found' });
    }

    const now = Date.now();
    if (now >= getHardExpiryMs(challenge)) {
      return res.status(410).json({ message: 'This challenge has expired' });
    }

    const existing = await DailyChallengeAttempt.findOne({
      challengeId,
      userId,
      isSubmitted: false,
    });

    if (existing) {
      existing.startedAt = new Date();
      await existing.save();
      return res.json({
        attemptId: existing._id,
        questions: challenge.questionSnapshot.map(stripForAttempt),
      });
    }

    const progress = await DailyChallengeProgress.findOne({ challengeId, userId }).lean();
    if ((progress?.attemptsSubmitted || 0) >= MAX_ATTEMPTS) {
      return res.status(403).json({ message: 'No attempts remaining' });
    }

    const attempt = new DailyChallengeAttempt({
      challengeId,
      userId,
      isSubmitted: false,
      startedAt: new Date(),
    });
    await attempt.save();

    res.json({
      attemptId: attempt._id,
      questions: challenge.questionSnapshot.map(stripForAttempt),
    });
  } catch (err) {
    console.error('START DAILY CHALLENGE ATTEMPT ERROR:', err);
    res.status(500).json({ message: 'Error starting daily challenge attempt' });
  }
};

exports.submitAttempt = async (req, res) => {
  try {
    const userId = getRequestUserId(req);
    if (!userId) return res.status(401).json({ message: 'User not authenticated' });

    const { challengeId, attemptId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(challengeId) || !mongoose.Types.ObjectId.isValid(attemptId)) {
      return res.status(400).json({ message: 'Invalid id' });
    }

    const challenge = await DailyChallenge.findById(challengeId).lean();
    if (!challenge) {
      return res.status(404).json({ message: 'Daily challenge not found' });
    }

    let attempt = await DailyChallengeAttempt.findById(attemptId);
    if (!attempt) {
      return res.status(404).json({ message: 'Attempt not found' });
    }
    if (attempt.userId.toString() !== userId.toString()) {
      return res.status(403).json({ message: 'Unauthorized attempt' });
    }
    if (String(attempt.challengeId) !== String(challengeId)) {
      return res.status(400).json({ message: 'Attempt does not belong to this challenge' });
    }

    if (attempt.isSubmitted) {
      // Idempotent replay of an already-completed submission.
      const progress = await DailyChallengeProgress.findOne({ challengeId, userId }).lean();
      return res.json(await buildSubmitResponse(challenge, attempt, progress));
    }

    const now = Date.now();
    if (now >= getHardExpiryMs(challenge)) {
      return res.status(410).json({ message: 'This challenge has expired and can no longer be submitted' });
    }

    // Atomically claim this specific attempt so a duplicate/concurrent submit can't consume two slots.
    const claimed = await DailyChallengeAttempt.findOneAndUpdate(
      { _id: attempt._id, userId, isSubmitted: false },
      { $set: { isSubmitted: true, submittedAt: new Date() } },
      { new: true }
    );

    if (!claimed) {
      // Lost the race to a concurrent identical request — replay its result.
      const finalAttempt = await DailyChallengeAttempt.findById(attempt._id).lean();
      const progress = await DailyChallengeProgress.findOne({ challengeId, userId }).lean();
      return res.json(await buildSubmitResponse(challenge, finalAttempt, progress));
    }

    attempt = claimed;

    let attemptNumber;
    try {
      attemptNumber = await consumeAttemptSlot(challengeId, userId);
    } catch (err) {
      if (err instanceof AttemptLimitError) {
        attempt.isVoid = true;
        attempt.voidReason = 'attempt_limit_exceeded';
        await attempt.save();
        return res.status(403).json({ message: 'No attempts remaining (3/3 used)' });
      }
      throw err;
    }

    const { score, evaluated } = scoreAgainstSnapshot(challenge.questionSnapshot, req.body.responses);
    const totalQuestions = challenge.questionSnapshot.length;
    const percentage = totalQuestions ? (score / totalQuestions) * 100 : 0;

    attempt.attemptNumber = attemptNumber;
    attempt.responses = evaluated;
    attempt.score = score;
    attempt.totalQuestions = totalQuestions;
    attempt.percentage = percentage;
    await attempt.save();

    const progress = await DailyChallengeProgress.findOneAndUpdate(
      { challengeId, userId },
      { $max: { bestScore: score, bestPercentage: percentage } },
      { new: true }
    ).lean();

    res.json(await buildSubmitResponse(challenge, attempt, progress));
  } catch (err) {
    console.error('SUBMIT DAILY CHALLENGE ATTEMPT ERROR:', err);
    res.status(500).json({ message: 'Error submitting daily challenge attempt' });
  }
};

async function buildSubmitResponse(challenge, attempt, progress) {
  const revealState = computeRevealState(challenge, progress);

  const responseByQuestionId = new Map();
  (attempt.responses || []).forEach((r) => {
    responseByQuestionId.set(String(r.questionId), r.selectedOptionIndex);
  });

  const questions = revealState.revealed
    ? challenge.questionSnapshot.map((q) => revealForAttempt(q, responseByQuestionId.get(String(q.questionId))))
    : null;

  let previousScore = null;
  if (attempt.attemptNumber > 1) {
    const previousAttempt = await DailyChallengeAttempt.findOne({
      challengeId: attempt.challengeId,
      userId: attempt.userId,
      attemptNumber: attempt.attemptNumber - 1,
    })
      .select('score')
      .lean();
    previousScore = previousAttempt?.score ?? null;
  }

  return {
    previousScore,
    attemptId: attempt._id,
    attemptNumber: attempt.attemptNumber,
    score: attempt.score,
    totalQuestions: attempt.totalQuestions,
    percentage: attempt.percentage,
    maxAttempts: MAX_ATTEMPTS,
    attemptsSubmitted: revealState.attemptsSubmitted,
    attemptsRemaining: revealState.attemptsRemaining,
    bestScore: progress?.bestScore ?? attempt.score,
    revealed: revealState.revealed,
    revealReason: revealState.reason,
    questions,
  };
}

exports.getAttempt = async (req, res) => {
  try {
    const userId = getRequestUserId(req);
    if (!userId) return res.status(401).json({ message: 'User not authenticated' });

    const { challengeId, attemptId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(challengeId) || !mongoose.Types.ObjectId.isValid(attemptId)) {
      return res.status(400).json({ message: 'Invalid id' });
    }

    const challenge = await DailyChallenge.findById(challengeId).lean();
    if (!challenge) {
      return res.status(404).json({ message: 'Daily challenge not found' });
    }

    const attempt = await DailyChallengeAttempt.findById(attemptId).lean();
    if (!attempt) {
      return res.status(404).json({ message: 'Attempt not found' });
    }
    if (attempt.userId.toString() !== userId.toString()) {
      return res.status(403).json({ message: 'Unauthorized attempt' });
    }
    if (!attempt.isSubmitted) {
      return res.status(400).json({ message: 'Attempt has not been submitted yet' });
    }

    const progress = await DailyChallengeProgress.findOne({ challengeId, userId }).lean();
    res.json(await buildSubmitResponse(challenge, attempt, progress));
  } catch (err) {
    console.error('GET DAILY CHALLENGE ATTEMPT ERROR:', err);
    res.status(500).json({ message: 'Error fetching daily challenge attempt' });
  }
};

exports.getHistory = async (req, res) => {
  try {
    const userId = getRequestUserId(req);
    if (!userId) return res.status(401).json({ message: 'User not authenticated' });

    const challenges = await DailyChallenge.find({ status: { $in: ['published', 'archived'] } })
      .sort({ publishedAt: -1 })
      .limit(60)
      .lean();

    if (!challenges.length) return res.json({ challenges: [] });

    const challengeIds = challenges.map((c) => c._id);

    const [progresses, submittedAttempts] = await Promise.all([
      DailyChallengeProgress.find({ userId, challengeId: { $in: challengeIds } }).lean(),
      DailyChallengeAttempt.find({
        userId,
        challengeId: { $in: challengeIds },
        isSubmitted: true,
        isVoid: { $ne: true },
      })
        .sort({ attemptNumber: -1 })
        .select('_id challengeId')
        .lean(),
    ]);

    const progressByChallenge = new Map(progresses.map((p) => [String(p.challengeId), p]));
    const latestAttemptIdByChallenge = new Map();
    submittedAttempts.forEach((a) => {
      const key = String(a.challengeId);
      if (!latestAttemptIdByChallenge.has(key)) {
        latestAttemptIdByChallenge.set(key, a._id);
      }
    });

    const history = challenges.map((challenge) => {
      const progress = progressByChallenge.get(String(challenge._id)) || null;
      const revealState = computeRevealState(challenge, progress);

      return {
        challengeId: challenge._id,
        title: challenge.title,
        publishedAt: challenge.publishedAt,
        expiresAt: challenge.expiresAt,
        questionCount: challenge.questionSnapshot?.length || 0,
        attemptsSubmitted: revealState.attemptsSubmitted,
        attemptsRemaining: revealState.attemptsRemaining,
        bestScore: progress?.bestScore ?? null,
        revealed: revealState.revealed,
        latestAttemptId: latestAttemptIdByChallenge.get(String(challenge._id)) || null,
      };
    });

    res.json({ challenges: history });
  } catch (err) {
    console.error('GET DAILY CHALLENGE HISTORY ERROR:', err);
    res.status(500).json({ message: 'Error fetching daily challenge history' });
  }
};

exports.getProgressSummary = async (req, res) => {
  try {
    const userId = getRequestUserId(req);
    if (!userId) return res.status(401).json({ message: 'User not authenticated' });

    const progresses = await DailyChallengeProgress.find({ userId }).lean();
    const completed = progresses.filter((p) => (p.attemptsSubmitted || 0) >= 1);

    const challengesCompleted = completed.length;
    const questionsAnswered = challengesCompleted * REQUIRED_QUESTION_COUNT;
    const correctAnswers = completed.reduce((sum, p) => sum + (p.bestScore || 0), 0);
    const accuracy = questionsAnswered ? (correctAnswers / questionsAnswered) * 100 : 0;
    const averageScore = challengesCompleted ? correctAnswers / challengesCompleted : 0;
    const bestScore = completed.length ? Math.max(...completed.map((p) => p.bestScore || 0)) : 0;

    const { currentStreak, longestStreak } = await computeStreak(userId);

    res.json({
      challengesCompleted,
      questionsAnswered,
      correctAnswers,
      accuracy,
      averageScore,
      bestScore,
      questionsPerChallenge: REQUIRED_QUESTION_COUNT,
      currentStreak,
      longestStreak,
    });
  } catch (err) {
    console.error('GET DAILY CHALLENGE PROGRESS SUMMARY ERROR:', err);
    res.status(500).json({ message: 'Error fetching daily challenge progress' });
  }
};

exports.getTopicPerformance = async (req, res) => {
  try {
    const userId = getRequestUserId(req);
    if (!userId) return res.status(401).json({ message: 'User not authenticated' });

    const submittedAttempts = await DailyChallengeAttempt.find({
      userId,
      isSubmitted: true,
      isVoid: { $ne: true },
    })
      .sort({ attemptNumber: -1 })
      .select('challengeId responses')
      .lean();

    if (!submittedAttempts.length) {
      return res.json({ topics: [], weakArea: null });
    }

    // Keep only each challenge's most recent attempt so retries don't skew topic accuracy.
    const latestAttemptByChallenge = new Map();
    submittedAttempts.forEach((a) => {
      const key = String(a.challengeId);
      if (!latestAttemptByChallenge.has(key)) {
        latestAttemptByChallenge.set(key, a);
      }
    });

    const challengeIds = [...latestAttemptByChallenge.keys()];
    const challenges = await DailyChallenge.find({ _id: { $in: challengeIds } })
      .select('questionSnapshot')
      .lean();

    const snapshotByChallengeId = new Map(
      challenges.map((c) => [
        String(c._id),
        new Map((c.questionSnapshot || []).map((q) => [String(q.questionId), q])),
      ])
    );

    const topicStats = new Map(); // topicId -> { correct, total }
    latestAttemptByChallenge.forEach((attempt, challengeKey) => {
      const snapshotMap = snapshotByChallengeId.get(challengeKey);
      if (!snapshotMap) return;

      (attempt.responses || []).forEach((r) => {
        const snapshot = snapshotMap.get(String(r.questionId));
        const topicId = snapshot?.topicId;
        if (!topicId) return;

        const key = String(topicId);
        const stats = topicStats.get(key) || { topicId, correct: 0, total: 0 };
        stats.total += 1;
        if (r.isCorrect) stats.correct += 1;
        topicStats.set(key, stats);
      });
    });

    const topicIds = [...topicStats.keys()];
    const topics = topicIds.length
      ? await Topic.find({ _id: { $in: topicIds } }).select('name').lean()
      : [];
    const topicNameById = new Map(topics.map((t) => [String(t._id), t.name]));

    const results = [...topicStats.values()].map((stats) => ({
      topicId: stats.topicId,
      topicName: topicNameById.get(String(stats.topicId)) || 'Unknown Topic',
      correct: stats.correct,
      total: stats.total,
      accuracy: stats.total ? (stats.correct / stats.total) * 100 : 0,
    }));

    results.sort((a, b) => b.accuracy - a.accuracy);
    const weakArea = results.length
      ? results.reduce((weakest, t) => (t.accuracy < weakest.accuracy ? t : weakest), results[0])
      : null;

    res.json({ topics: results, weakArea });
  } catch (err) {
    console.error('GET DAILY CHALLENGE TOPIC PERFORMANCE ERROR:', err);
    res.status(500).json({ message: 'Error fetching topic performance' });
  }
};

// Ranks students by total Daily Challenge points (sum of each challenge's best score), tie-broken
// by challenges completed. Always includes the requesting student's own rank, even if they fall
// outside the top LEADERBOARD_LIMIT.
exports.getLeaderboard = async (req, res) => {
  try {
    const userId = getRequestUserId(req);
    if (!userId) return res.status(401).json({ message: 'User not authenticated' });

    const ranked = await DailyChallengeProgress.aggregate([
      { $match: { attemptsSubmitted: { $gte: 1 } } },
      {
        $group: {
          _id: '$userId',
          totalScore: { $sum: { $ifNull: ['$bestScore', 0] } },
          challengesCompleted: { $sum: 1 },
        },
      },
      { $sort: { totalScore: -1, challengesCompleted: -1 } },
    ]);

    if (!ranked.length) {
      return res.json({ leaderboard: [], me: null });
    }

    const topRanked = ranked.slice(0, LEADERBOARD_LIMIT);
    const meIndex = ranked.findIndex((r) => String(r._id) === String(userId));
    const meIncludedInTop = meIndex !== -1 && meIndex < LEADERBOARD_LIMIT;

    const neededUserIds = topRanked.map((r) => r._id);
    if (meIndex !== -1 && !meIncludedInTop) neededUserIds.push(ranked[meIndex]._id);

    const [users, streaksByUserId] = await Promise.all([
      User.find({ _id: { $in: neededUserIds } }).select('name email').lean(),
      computeStreaksForUsers(neededUserIds),
    ]);
    const userById = new Map(users.map((u) => [String(u._id), u]));

    const toEntry = (row, rank) => {
      const user = userById.get(String(row._id));
      const streak = streaksByUserId.get(String(row._id)) || { currentStreak: 0, longestStreak: 0 };
      return {
        rank,
        userId: row._id,
        name: user?.name || user?.email || 'Student',
        totalScore: row.totalScore,
        challengesCompleted: row.challengesCompleted,
        currentStreak: streak.currentStreak,
        isMe: String(row._id) === String(userId),
      };
    };

    const leaderboard = topRanked.map((row, i) => toEntry(row, i + 1));
    const me = meIndex !== -1 ? toEntry(ranked[meIndex], meIndex + 1) : null;

    res.json({ leaderboard, me });
  } catch (err) {
    console.error('GET DAILY CHALLENGE LEADERBOARD ERROR:', err);
    res.status(500).json({ message: 'Error fetching leaderboard' });
  }
};
