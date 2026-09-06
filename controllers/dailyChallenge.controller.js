const mongoose = require('mongoose');
const DailyChallenge = require('../models/DailyChallenge');
const DailyChallengeAttempt = require('../models/DailyChallengeAttempt');
const DailyChallengeProgress = require('../models/DailyChallengeProgress');
const Topic = require('../models/Topic');
const Unit = require('../models/Unit');
const Question = require('../models/Question');
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
  getStreakHistory,
  computeStreaksForUsers,
  computeLeaderboardPoints,
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
      responseByQuestionId.set(String(r.questionId), r);
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

    const { examId } = req.query;
    const challengeFilter = { status: 'published' };
    if (examId && mongoose.Types.ObjectId.isValid(examId)) {
      challengeFilter.examId = examId;
    }

    const challenge = await DailyChallenge.findOne(challengeFilter)
      .sort({ publishedAt: -1 })
      .lean();

    if (!challenge) {
      return res.json({ challenge: null });
    }

    // Defensive: a challenge published without a questionSnapshot (e.g. from a publish path that
    // predates snapshot-building, or bad data) can't be rendered — surface it as "no challenge" to
    // the student rather than crashing the whole endpoint.
    if (!Array.isArray(challenge.questionSnapshot) || challenge.questionSnapshot.length === 0) {
      console.error('DAILY CHALLENGE MISSING SNAPSHOT:', challenge._id);
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
    if (!Array.isArray(challenge.questionSnapshot) || challenge.questionSnapshot.length === 0) {
      return res.status(422).json({ message: 'This challenge has no usable questions' });
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

    // The shared `dailychallengeattempts` collection also enforces the website backend's unique
    // index on {challengeId, studentEmail, attemptNumber} — omitting studentEmail here would leave
    // it null on every attempt, so a second student's attempt on the same challenge would collide
    // with the first student's on that index (independent of userId, which the website's index
    // doesn't know about).
    const user = await User.findById(userId).select('email').lean();

    const attempt = new DailyChallengeAttempt({
      challengeId,
      userId,
      studentEmail: user?.email || null,
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
  const { currentStreak } = await computeStreak(attempt.userId);

  const responseByQuestionId = new Map();
  (attempt.responses || []).forEach((r) => {
    responseByQuestionId.set(String(r.questionId), r);
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
    currentStreak,
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

exports.getStreakHistory = async (req, res) => {
  try {
    const userId = getRequestUserId(req);
    if (!userId) return res.status(401).json({ message: 'User not authenticated' });

    const limit = Math.min(30, Math.max(1, parseInt(req.query.limit, 10) || 14));
    const history = await getStreakHistory(userId, limit);

    res.json({ history });
  } catch (err) {
    console.error('GET DAILY CHALLENGE STREAK HISTORY ERROR:', err);
    res.status(500).json({ message: 'Error fetching streak history' });
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

// How many of the most recent challenges the unit archive endpoints look back through — same
// window as getHistory, so this can't grow unbounded for a long-tenured user.
const UNIT_ARCHIVE_CHALLENGE_LOOKBACK = 60;

// Shared basis for the unit-scoped archive endpoints below: for a user, each challenge (within the
// last UNIT_ARCHIVE_CHALLENGE_LOOKBACK published/archived challenges) they've submitted at least one
// attempt for that has since revealed (per computeRevealState), paired with their latest attempt on
// it. Sorted newest challenge first.
async function getRevealedChallengesForUser(userId) {
  const challenges = await DailyChallenge.find({ status: { $in: ['published', 'archived'] } })
    .sort({ publishedAt: -1 })
    .limit(UNIT_ARCHIVE_CHALLENGE_LOOKBACK)
    .lean();

  if (!challenges.length) return [];

  const challengeIds = challenges.map((c) => c._id);

  const [submittedAttempts, progresses] = await Promise.all([
    DailyChallengeAttempt.find({
      userId,
      challengeId: { $in: challengeIds },
      isSubmitted: true,
      isVoid: { $ne: true },
    })
      .sort({ attemptNumber: -1 })
      .lean(),
    DailyChallengeProgress.find({ userId, challengeId: { $in: challengeIds } }).lean(),
  ]);

  if (!submittedAttempts.length) return [];

  // Keep only each challenge's most recent attempt, same idiom as getTopicPerformance.
  const latestAttemptByChallenge = new Map();
  submittedAttempts.forEach((a) => {
    const key = String(a.challengeId);
    if (!latestAttemptByChallenge.has(key)) {
      latestAttemptByChallenge.set(key, a);
    }
  });

  const progressByChallenge = new Map(progresses.map((p) => [String(p.challengeId), p]));

  const revealed = [];
  challenges.forEach((challenge) => {
    const attempt = latestAttemptByChallenge.get(String(challenge._id));
    if (!attempt) return; // user never submitted this one

    // Defensive: same guard as getToday — a challenge with no usable snapshot can't be rendered.
    if (!Array.isArray(challenge.questionSnapshot) || challenge.questionSnapshot.length === 0) return;

    const progress = progressByChallenge.get(String(challenge._id)) || null;
    const revealState = computeRevealState(challenge, progress);
    if (!revealState.revealed) return; // gating rule: only revealed (3 attempts used or expired) challenges surface here

    revealed.push({ challenge, attempt });
  });

  // Already newest-first: `challenges` was fetched sorted by publishedAt desc and iterated in order.
  return revealed;
}

// Lists units (scoped to examId when provided, same set Practice's content.controller.getUnits
// shows) decorated with whether each has topics and how many of the student's revealed
// daily-challenge questions belong to it — the two facts the Daily Challenge tab needs to decide
// what a unit tap should open.
exports.getUnitsWithProgress = async (req, res) => {
  try {
    const userId = getRequestUserId(req);
    if (!userId) return res.status(401).json({ message: 'User not authenticated' });

    const { examId } = req.query;
    const unitFilter = { isActive: { $ne: false } };
    if (examId && mongoose.Types.ObjectId.isValid(examId)) {
      unitFilter.examId = examId;
    }

    const units = await Unit.find(unitFilter).sort({ order: 1 }).lean();
    if (!units.length) return res.json({ units: [] });

    const unitIds = units.map((u) => u._id);
    const topicCounts = await Topic.aggregate([
      { $match: { unitId: { $in: unitIds }, isActive: { $ne: false } } },
      { $group: { _id: '$unitId', count: { $sum: 1 } } },
    ]);
    const hasTopicsByUnitId = new Map(topicCounts.map((t) => [String(t._id), t.count > 0]));

    const revealedChallenges = await getRevealedChallengesForUser(userId);

    const poolQuestionIds = [];
    revealedChallenges.forEach(({ challenge }) => {
      challenge.questionSnapshot.forEach((q) => poolQuestionIds.push(q.questionId));
    });

    // Attribute each snapshot question to a unit via the live Question doc — the snapshot itself
    // only carries topicId/subtopicId, never unitId, and a question can have a unit with no topic.
    const questionDocs = poolQuestionIds.length
      ? await Question.find({ _id: { $in: poolQuestionIds } }).select('unitId').lean()
      : [];
    const unitIdByQuestionId = new Map(
      questionDocs.map((q) => [String(q._id), q.unitId ? String(q.unitId) : null])
    );

    const questionCountByUnitId = new Map();
    revealedChallenges.forEach(({ challenge }) => {
      challenge.questionSnapshot.forEach((q) => {
        const unitId = unitIdByQuestionId.get(String(q.questionId));
        if (!unitId) return; // Question deleted since, or never had a unit — can't attribute, so drop it
        questionCountByUnitId.set(unitId, (questionCountByUnitId.get(unitId) || 0) + 1);
      });
    });

    const decorated = units.map((u) => ({
      _id: u._id,
      name: u.name,
      order: u.order,
      hasTopics: hasTopicsByUnitId.get(String(u._id)) || false,
      questionCount: questionCountByUnitId.get(String(u._id)) || 0,
    }));

    res.json({ units: decorated });
  } catch (err) {
    console.error('GET DAILY CHALLENGE UNITS ERROR:', err);
    res.status(500).json({ message: 'Error fetching daily challenge units' });
  }
};

// Flattened, newest-first archive of a student's revealed daily-challenge questions for one unit
// (optionally further filtered to one topic) — the leaf view behind the Daily Challenge tab's
// unit -> (topics ->) drill-down.
exports.getUnitHistory = async (req, res) => {
  try {
    const userId = getRequestUserId(req);
    if (!userId) return res.status(401).json({ message: 'User not authenticated' });

    const { unitId } = req.params;
    const { topicId } = req.query;
    if (!mongoose.Types.ObjectId.isValid(unitId)) {
      return res.status(400).json({ message: 'Invalid unit id' });
    }
    if (topicId && !mongoose.Types.ObjectId.isValid(topicId)) {
      return res.status(400).json({ message: 'Invalid topic id' });
    }

    const unit = await Unit.findOne({ _id: unitId, isActive: { $ne: false } }).select('name').lean();
    if (!unit) {
      return res.status(404).json({ message: 'Unit not found' });
    }

    // Fetched for its name only — a topic no longer belonging to this unit still filters results below.
    const topic = topicId ? await Topic.findById(topicId).select('name').lean() : null;

    const revealedChallenges = await getRevealedChallengesForUser(userId);

    const allQuestionIds = [];
    revealedChallenges.forEach(({ challenge }) => {
      challenge.questionSnapshot.forEach((q) => allQuestionIds.push(q.questionId));
    });

    const questionDocs = allQuestionIds.length
      ? await Question.find({ _id: { $in: allQuestionIds } }).select('unitId topicId').lean()
      : [];
    const questionInfoById = new Map(questionDocs.map((q) => [String(q._id), q]));

    const questions = [];
    revealedChallenges.forEach(({ challenge, attempt }) => {
      const responseByQuestionId = new Map(
        (attempt.responses || []).map((r) => [String(r.questionId), r])
      );

      challenge.questionSnapshot.forEach((snapshotEntry) => {
        const info = questionInfoById.get(String(snapshotEntry.questionId));
        if (!info || !info.unitId || String(info.unitId) !== String(unitId)) return; // unresolved or wrong unit
        if (topicId && String(info.topicId || snapshotEntry.topicId || '') !== String(topicId)) return;

        const revealedEntry = revealForAttempt(
          snapshotEntry,
          responseByQuestionId.get(String(snapshotEntry.questionId))
        );
        questions.push({
          ...revealedEntry,
          challengeId: challenge._id,
          publishedAt: challenge.publishedAt,
        });
      });
    });

    res.json({
      unitId,
      unitName: unit.name,
      topicId: topicId || null,
      topicName: topic?.name || null,
      questions,
    });
  } catch (err) {
    console.error('GET DAILY CHALLENGE UNIT HISTORY ERROR:', err);
    res.status(500).json({ message: 'Error fetching daily challenge unit history' });
  }
};

// Ranks students by total Daily Challenge points (sum of each challenge's best score), tie-broken
// by challenges completed. Always includes the requesting student's own rank, even if they fall
// outside the top LEADERBOARD_LIMIT.
exports.getLeaderboard = async (req, res) => {
  try {
    const userId = getRequestUserId(req);
    if (!userId) return res.status(401).json({ message: 'User not authenticated' });

    const participantIds = await DailyChallengeProgress.distinct('userId', { attemptsSubmitted: { $gte: 1 } });
    if (!participantIds.length) {
      return res.json({ leaderboard: [], me: null });
    }

    // Points, not a raw score sum: an attempted challenge adds its best score, but a challenge a
    // participant never attempted subtracts MISSED_DAY_PENALTY instead of contributing 0 — ignoring
    // the Daily Challenge should cost you, not just fail to help you.
    const pointsByUserId = await computeLeaderboardPoints(participantIds);
    const ranked = participantIds
      .map((id) => {
        const points = pointsByUserId.get(String(id)) || { totalPoints: 0, challengesCompleted: 0 };
        return { _id: id, totalScore: points.totalPoints, challengesCompleted: points.challengesCompleted };
      })
      .sort((a, b) => b.totalScore - a.totalScore || b.challengesCompleted - a.challengesCompleted);

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
