const { isNumericalAnswerCorrect } = require('./questionFormat');
const DailyChallengeProgress = require('../models/DailyChallengeProgress');
const DailyChallenge = require('../models/DailyChallenge');
const User = require('../models/User');
const { sendNotification } = require('../services/notification.service');

const DEFAULT_MAX_ATTEMPTS = 3;

function getMaxAttempts(challenge) {
  return typeof challenge.maxAttempts === 'number' && challenge.maxAttempts > 0
    ? challenge.maxAttempts
    : DEFAULT_MAX_ATTEMPTS;
}
const REQUIRED_QUESTION_COUNT = 5;
const REMINDER_AFTER_MS = 24 * 60 * 60 * 1000;
const ENDING_SOON_WINDOW_MS = 12 * 60 * 60 * 1000;

const PUBLISH_NOTICE_WINDOW_MS = 20 * 60 * 1000;

class AttemptLimitError extends Error {
  constructor() {
    super('No attempts remaining');
  }
}

function stripForAttempt(snapshotQuestion) {
  return {
    questionId: snapshotQuestion.questionId,
    order: snapshotQuestion.order,
    questionText: snapshotQuestion.questionText,
    questionImage: snapshotQuestion.questionImage,
    options: snapshotQuestion.options,
    optionImages: snapshotQuestion.optionImages,
    answerType: snapshotQuestion.answerType || 'single',
  };
}

const LISTED_CHALLENGE_STATUSES = ['published', 'expired', 'archived'];

function revealForAttempt(snapshotQuestion, response) {
  const selectedOptionIndex = typeof response === 'number' ? response : response?.selectedOptionIndex;

  return {
    questionId: snapshotQuestion.questionId,
    order: snapshotQuestion.order,
    questionText: snapshotQuestion.questionText,
    questionImage: snapshotQuestion.questionImage,
    options: snapshotQuestion.options,
    optionImages: snapshotQuestion.optionImages,
    answerType: snapshotQuestion.answerType || 'single',
    correctOptionIndex: snapshotQuestion.correctOptionIndex,
    correctOptionIndexes: snapshotQuestion.correctOptionIndexes || [],
    numericalAnswer: snapshotQuestion.numericalAnswer || '',
    selectedOptionIndex: typeof selectedOptionIndex === 'number' ? selectedOptionIndex : null,
    selectedOptionIndexes: Array.isArray(response?.selectedOptionIndexes) ? response.selectedOptionIndexes : [],
    selectedNumericalAnswer: typeof response?.selectedNumericalAnswer === 'string' ? response.selectedNumericalAnswer : '',
    explanation: snapshotQuestion.explanation && snapshotQuestion.explanation.trim()
      ? snapshotQuestion.explanation
      : 'No explanation provided.',
    explanationImage: snapshotQuestion.explanationImage || '',
  };
}

function getHardExpiryMs(challenge) {
  const expiresAtMs = new Date(challenge.expiresAt).getTime();
  if (!challenge.earlyClosedAt) return expiresAtMs;
  const earlyClosedMs = new Date(challenge.earlyClosedAt).getTime();
  return Math.min(expiresAtMs, earlyClosedMs);
}

function computeRevealState(challenge, progress) {
  const now = Date.now();
  const hardExpiryMs = getHardExpiryMs(challenge);
  const maxAttempts = getMaxAttempts(challenge);
  const attemptsSubmitted = progress?.attemptsSubmitted || 0;

  const expired = now >= hardExpiryMs;
  const exhausted = attemptsSubmitted >= maxAttempts;
  const revealed = expired || exhausted;

  let reason = null;
  if (revealed) {
    reason = expired && exhausted ? 'both' : expired ? 'expired' : 'attempts_exhausted';
  }

  return {
    revealed,
    reason,
    expired,
    attemptsSubmitted,
    attemptsRemaining: Math.max(0, maxAttempts - attemptsSubmitted),
  };
}

async function consumeAttemptSlot(challengeId, userId, maxAttempts) {
  for (let i = 0; i < 2; i++) {
    try {
      const progress = await DailyChallengeProgress.findOneAndUpdate(
        { challengeId, userId, attemptsSubmitted: { $lt: maxAttempts } },
        { $inc: { attemptsSubmitted: 1 }, $set: { lastAttemptAt: new Date() } },
        { new: true, upsert: true }
      );
      return progress.attemptsSubmitted;
    } catch (err) {
      if (err.code === 11000 && i === 0) continue;
      if (err.code === 11000) throw new AttemptLimitError();
      throw err;
    }
  }
  throw new AttemptLimitError();
}

function scoreAgainstSnapshot(questionSnapshot, submittedResponses) {
  const answerMap = new Map();
  (submittedResponses || []).forEach((r) => {
    if (
      r &&
      r.questionId &&
      (typeof r.selectedOptionIndex === 'number' ||
        Array.isArray(r.selectedOptionIndexes) ||
        typeof r.selectedNumericalAnswer === 'string')
    ) {
      answerMap.set(String(r.questionId), r);
    }
  });

  let score = 0;
  const evaluated = questionSnapshot.map((q) => {
    const answerType = q.answerType || 'single';
    const submitted = answerMap.get(String(q.questionId));

    let selectedOptionIndex = null;
    let selectedOptionIndexes = null;
    let selectedNumericalAnswer = null;
    let isCorrect = false;

    if (answerType === 'multiple') {
      if (submitted && Array.isArray(submitted.selectedOptionIndexes)) {
        selectedOptionIndexes = submitted.selectedOptionIndexes.filter(
          (idx) => typeof idx === 'number' && idx >= 0 && idx < (q.options?.length || 0)
        );
      }

      const correctIndexes = q.correctOptionIndexes || [];
      if (selectedOptionIndexes && correctIndexes.length > 0) {
        const selectedSet = new Set(selectedOptionIndexes);
        const correctSet = new Set(correctIndexes);
        isCorrect =
          selectedSet.size === correctSet.size &&
          [...selectedSet].every((idx) => correctSet.has(idx));
      }
    } else if (answerType === 'numerical') {
      if (submitted && typeof submitted.selectedNumericalAnswer === 'string') {
        selectedNumericalAnswer = submitted.selectedNumericalAnswer;
      }

      isCorrect = isNumericalAnswerCorrect(selectedNumericalAnswer, q.numericalAnswer);
    } else {
      if (submitted && typeof submitted.selectedOptionIndex === 'number') {
        selectedOptionIndex = submitted.selectedOptionIndex;
      }
      if (
        typeof selectedOptionIndex !== 'number' ||
        selectedOptionIndex < 0 ||
        selectedOptionIndex >= (q.options?.length || 0)
      ) {
        selectedOptionIndex = null;
      }

      isCorrect = selectedOptionIndex !== null && selectedOptionIndex === q.correctOptionIndex;
    }

    if (isCorrect) score += 1;

    return {
      questionId: q.questionId,
      selectedOptionIndex,
      selectedOptionIndexes,
      selectedNumericalAnswer,
      isCorrect,
    };
  });

  return { score, evaluated };
}

async function createNotificationOnce({ userId, type, title, message, dailyChallengeId, pushToken }) {
  const result = await sendNotification({
    userId,
    type,
    title,
    body: message,
    dailyChallengeId,
    data: { dailyChallengeId },
    pushToken,
  });
  return result.created;
}

async function maybeCreateReminders(challenge, userId, revealState, pushToken) {
  if (revealState.revealed) return;

  const now = Date.now();
  const publishedAtMs = new Date(challenge.publishedAt).getTime();
  const hardExpiryMs = getHardExpiryMs(challenge);

  if (now - publishedAtMs <= PUBLISH_NOTICE_WINDOW_MS) {
    await createNotificationOnce({
      userId,
      type: 'daily_challenge_published',
      title: '🔔 New C3 Daily Challenge',
      message: `Today's Daily Challenge is now available. ${REQUIRED_QUESTION_COUNT} questions, ${getMaxAttempts(challenge)} attempts.`,
      dailyChallengeId: challenge._id,
      pushToken,
    });
  }

  if (now - publishedAtMs >= REMINDER_AFTER_MS) {
    await createNotificationOnce({
      userId,
      type: 'daily_challenge_reminder',
      title: '⏰ Daily Challenge Reminder',
      message: "You still have time to complete today's 5 questions.",
      dailyChallengeId: challenge._id,
      pushToken,
    });
  }

  if (hardExpiryMs - now <= ENDING_SOON_WINDOW_MS && hardExpiryMs - now > 0) {
    await createNotificationOnce({
      userId,
      type: 'daily_challenge_ending_soon',
      title: '⚠️ Daily Challenge Ending Soon',
      message: 'Your Daily Challenge expires soon. Complete it before the deadline.',
      dailyChallengeId: challenge._id,
      pushToken,
    });
  }
}

function isStillOpen(challenge, now = Date.now()) {
  if (challenge.status !== 'published' || challenge.earlyClosedAt) return false;
  return !challenge.expiresAt || new Date(challenge.expiresAt).getTime() > now;
}

function foldStreaks(challenges, completedSet) {
  const now = Date.now();

  let currentStreak = 0;
  for (let i = 0; i < challenges.length; i++) {
    const c = challenges[i];
    if (completedSet.has(String(c._id))) currentStreak += 1;
    else if (i === 0 && isStillOpen(c, now)) continue;
    else break;
  }

  let longestStreak = 0;
  let running = 0;
  let overallStreak = 0;
  for (let i = challenges.length - 1; i >= 0; i--) {
    if (completedSet.has(String(challenges[i]._id))) {
      running += 1;
      overallStreak += 1;
      longestStreak = Math.max(longestStreak, running);
    } else {
      running = 0;
    }
  }

  return { currentStreak, longestStreak, overallStreak };
}

const EMPTY_STREAKS = { currentStreak: 0, longestStreak: 0, overallStreak: 0 };

async function computeStreak(userId) {
  const challenges = await DailyChallenge.find({ status: { $in: LISTED_CHALLENGE_STATUSES } })
    .select('_id publishedAt status expiresAt earlyClosedAt')
    .sort({ publishedAt: -1 })
    .lean();

  if (!challenges.length) {
    return { ...EMPTY_STREAKS };
  }

  const challengeIds = challenges.map((c) => c._id);
  const completedProgress = await DailyChallengeProgress.find({
    userId,
    challengeId: { $in: challengeIds },
    attemptsSubmitted: { $gte: 1 },
  })
    .select('challengeId')
    .lean();
  const completedSet = new Set(completedProgress.map((p) => String(p.challengeId)));

  return foldStreaks(challenges, completedSet);
}

async function getStreakHistory(userId, limit = 14) {
  const challenges = await DailyChallenge.find({ status: { $in: LISTED_CHALLENGE_STATUSES } })
    .select('_id dateKey publishedAt')
    .sort({ publishedAt: -1 })
    .limit(limit)
    .lean();

  if (!challenges.length) return [];

  const challengeIds = challenges.map((c) => c._id);
  const completedProgress = await DailyChallengeProgress.find({
    userId,
    challengeId: { $in: challengeIds },
    attemptsSubmitted: { $gte: 1 },
  })
    .select('challengeId')
    .lean();
  const completedSet = new Set(completedProgress.map((p) => String(p.challengeId)));

  return challenges
    .map((c) => ({
      dateKey: c.dateKey,
      completed: completedSet.has(String(c._id)),
    }))
    .reverse();
}

async function computeStreaksForUsers(userIds) {
  const uniqueUserIds = [...new Set(userIds.map((id) => String(id)))];
  const streakByUserId = new Map(uniqueUserIds.map((id) => [id, { ...EMPTY_STREAKS }]));

  const challenges = await DailyChallenge.find({ status: { $in: LISTED_CHALLENGE_STATUSES } })
    .select('_id publishedAt status expiresAt earlyClosedAt')
    .sort({ publishedAt: -1 })
    .lean();
  if (!challenges.length) return streakByUserId;

  const challengeIds = challenges.map((c) => c._id);
  const completedProgress = await DailyChallengeProgress.find({
    userId: { $in: uniqueUserIds },
    challengeId: { $in: challengeIds },
    attemptsSubmitted: { $gte: 1 },
  })
    .select('userId challengeId')
    .lean();

  const completedByUser = new Map();
  completedProgress.forEach((p) => {
    const key = String(p.userId);
    if (!completedByUser.has(key)) completedByUser.set(key, new Set());
    completedByUser.get(key).add(String(p.challengeId));
  });

  uniqueUserIds.forEach((userId) => {
    const completedSet = completedByUser.get(userId) || new Set();
    streakByUserId.set(userId, foldStreaks(challenges, completedSet));
  });

  return streakByUserId;
}

const MISSED_DAY_PENALTY = 10;

async function computeLeaderboardPoints(userIds) {
  const uniqueUserIds = [...new Set(userIds.map((id) => String(id)))];
  const pointsByUserId = new Map(uniqueUserIds.map((id) => [id, { totalPoints: 0, challengesCompleted: 0 }]));

  const challenges = await DailyChallenge.find({ status: { $in: LISTED_CHALLENGE_STATUSES } })
    .select('_id publishedAt')
    .lean();
  if (!challenges.length) return pointsByUserId;

  const challengeIds = challenges.map((c) => c._id);

  const [progresses, users] = await Promise.all([
    DailyChallengeProgress.find({ userId: { $in: uniqueUserIds }, challengeId: { $in: challengeIds } })
      .select('userId challengeId attemptsSubmitted bestScore')
      .lean(),
    User.find({ _id: { $in: uniqueUserIds } }).select('createdAt').lean(),
  ]);

  const createdAtByUserId = new Map(
    users.map((u) => [String(u._id), u.createdAt ? new Date(u.createdAt) : null])
  );

  const progressByUser = new Map();
  progresses.forEach((p) => {
    const key = String(p.userId);
    if (!progressByUser.has(key)) progressByUser.set(key, new Map());
    progressByUser.get(key).set(String(p.challengeId), p);
  });

  uniqueUserIds.forEach((userId) => {
    const joinedAt = createdAtByUserId.get(userId);
    const userProgress = progressByUser.get(userId) || new Map();
    let totalPoints = 0;
    let challengesCompleted = 0;

    challenges.forEach((c) => {
      if (joinedAt && new Date(c.publishedAt) < joinedAt) return;

      const progress = userProgress.get(String(c._id));
      if (progress && (progress.attemptsSubmitted || 0) >= 1) {
        totalPoints += progress.bestScore || 0;
        challengesCompleted += 1;
      } else {
        totalPoints -= MISSED_DAY_PENALTY;
      }
    });

    pointsByUserId.set(userId, { totalPoints, challengesCompleted });
  });

  return pointsByUserId;
}

module.exports = {
  LISTED_CHALLENGE_STATUSES,
  getMaxAttempts,
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
};
