const { getCorrectOptionIndex, getOptionText, normalizeQuestionOptions, normalizeQuestionOptionImages } = require('./questionFormat');
const DailyChallengeProgress = require('../models/DailyChallengeProgress');
const DailyChallenge = require('../models/DailyChallenge');
const Notification = require('../models/Notification');
const User = require('../models/User');
const { sendExpoPushNotifications } = require('./expoPush');

const CHALLENGE_DURATION_MS = 3 * 24 * 60 * 60 * 1000; // 3 days
const MAX_ATTEMPTS = 3;
const REQUIRED_QUESTION_COUNT = 5;
const REMINDER_AFTER_MS = 24 * 60 * 60 * 1000; // 24 hours after publish
const ENDING_SOON_WINDOW_MS = 12 * 60 * 60 * 1000; // last 12 hours before expiry

class AttemptLimitError extends Error {
  constructor() {
    super('No attempts remaining');
  }
}

function getUtcDateKey(date) {
  return date.toISOString().slice(0, 10); // 'YYYY-MM-DD'
}

// Builds the frozen snapshot stored on the DailyChallenge document at publish time.
// questionDocs: array of raw Question mongoose docs/objects, in ANY order.
// orderedIds: array of question id strings in the admin-chosen display order.
function buildQuestionSnapshot(questionDocs, orderedIds) {
  const byId = new Map(questionDocs.map((q) => [String(q._id), q]));

  return orderedIds.map((id, index) => {
    const q = byId.get(String(id));
    if (!q) return null;

    const options = normalizeQuestionOptions(q.options);
    const optionImages = normalizeQuestionOptionImages(q.optionImages, q.options);
    const correctOptionIndex = getCorrectOptionIndex(q);

    return {
      questionId: q._id,
      order: index,
      questionText: q.question || q.questionText || '',
      questionImage: q.questionImage || '',
      options: options.map((opt) => getOptionText(opt)),
      optionImages,
      correctOptionIndex,
      explanation: q.explanation || '',
      explanationImage: q.explanationImage || '',
      topicId: q.topicId || null,
      subtopicId: q.subtopicId || null,
    };
  });
}

// Question payload sent to a student BEFORE the answer is allowed to be revealed.
function stripForAttempt(snapshotQuestion) {
  return {
    questionId: snapshotQuestion.questionId,
    order: snapshotQuestion.order,
    questionText: snapshotQuestion.questionText,
    questionImage: snapshotQuestion.questionImage,
    options: snapshotQuestion.options,
    optionImages: snapshotQuestion.optionImages,
  };
}

// Question payload sent to a student AFTER reveal is allowed (3rd attempt or expiry).
function revealForAttempt(snapshotQuestion, selectedOptionIndex) {
  return {
    questionId: snapshotQuestion.questionId,
    order: snapshotQuestion.order,
    questionText: snapshotQuestion.questionText,
    questionImage: snapshotQuestion.questionImage,
    options: snapshotQuestion.options,
    optionImages: snapshotQuestion.optionImages,
    correctOptionIndex: snapshotQuestion.correctOptionIndex,
    selectedOptionIndex: typeof selectedOptionIndex === 'number' ? selectedOptionIndex : null,
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

// Pure, derived-at-read-time reveal state. Never stored, so it can't go stale.
function computeRevealState(challenge, progress) {
  const now = Date.now();
  const hardExpiryMs = getHardExpiryMs(challenge);
  const attemptsSubmitted = progress?.attemptsSubmitted || 0;

  const expired = now >= hardExpiryMs;
  const exhausted = attemptsSubmitted >= MAX_ATTEMPTS;
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
    attemptsRemaining: Math.max(0, MAX_ATTEMPTS - attemptsSubmitted),
  };
}

// Atomically claims the next attempt slot (1, 2, or 3) for a user on a challenge.
// Race-safe under concurrent submits: see plan doc for the retry rationale.
async function consumeAttemptSlot(challengeId, userId) {
  for (let i = 0; i < 2; i++) {
    try {
      const progress = await DailyChallengeProgress.findOneAndUpdate(
        { challengeId, userId, attemptsSubmitted: { $lt: MAX_ATTEMPTS } },
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

// Re-scores against the frozen snapshot only. Never trusts client-sent isCorrect/score.
function scoreAgainstSnapshot(questionSnapshot, submittedResponses) {
  const answerMap = new Map();
  (submittedResponses || []).forEach((r) => {
    if (r && r.questionId && typeof r.selectedOptionIndex === 'number') {
      answerMap.set(String(r.questionId), r.selectedOptionIndex);
    }
  });

  let score = 0;
  const evaluated = questionSnapshot.map((q) => {
    let selectedOptionIndex = answerMap.has(String(q.questionId)) ? answerMap.get(String(q.questionId)) : null;
    if (
      typeof selectedOptionIndex !== 'number' ||
      selectedOptionIndex < 0 ||
      selectedOptionIndex >= (q.options?.length || 0)
    ) {
      selectedOptionIndex = null;
    }

    const isCorrect = selectedOptionIndex !== null && selectedOptionIndex === q.correctOptionIndex;
    if (isCorrect) score += 1;

    return {
      questionId: q.questionId,
      selectedOptionIndex,
      isCorrect,
    };
  });

  return { score, evaluated };
}

// Inserts a notification, silently ignoring a duplicate (userId+dailyChallengeId+type already exists).
// This is the single dedup mechanism for both publish-notices and reminders — no separate "already sent" flag needed.
// On first insert (not a dup), also fires an actual Expo push so the reminder reaches students who
// haven't opened the app — pass `pushToken` when the caller already has it (e.g. the sweep job) to
// avoid an extra User lookup per notification; otherwise it's looked up here.
async function createNotificationOnce({ userId, type, title, message, dailyChallengeId, pushToken }) {
  try {
    await Notification.create({ userId, type, title, message, dailyChallengeId });
  } catch (err) {
    if (err.code === 11000) return false; // already sent, not an error
    throw err;
  }

  let token = pushToken;
  if (token === undefined) {
    const user = await User.findById(userId).select('expoPushToken').lean();
    token = user?.expoPushToken;
  }
  if (token) {
    sendExpoPushNotifications([{ to: token, title, body: message, data: { type, dailyChallengeId: String(dailyChallengeId || '') } }]).catch(
      (err) => console.error('[dailyChallengeHelpers] push send error:', err.message)
    );
  }

  return true;
}

// Generates the 24h and ending-soon reminders for one student on one challenge — called both lazily
// (as a side effect of the student checking in) and proactively (from the reminder sweep job, which
// is what actually reaches students who haven't opened the app). Dedup is enforced by the unique
// index on Notification, so calling this repeatedly for the same student+challenge is always safe.
async function maybeCreateReminders(challenge, userId, revealState, pushToken) {
  if (revealState.revealed) return; // nothing to remind about once completed/expired

  const now = Date.now();
  const publishedAtMs = new Date(challenge.publishedAt).getTime();
  const hardExpiryMs = getHardExpiryMs(challenge);

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

// Streak is defined over the sequence of published/archived challenges a student could have completed
// (ordered by publish date), not raw calendar days — so a day with no challenge published never breaks
// a streak, only actually missing a published challenge does.
async function computeStreak(userId) {
  const challenges = await DailyChallenge.find({ status: { $in: ['published', 'archived'] } })
    .select('_id publishedAt')
    .sort({ publishedAt: -1 })
    .lean();

  if (!challenges.length) {
    return { currentStreak: 0, longestStreak: 0 };
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

  let currentStreak = 0;
  for (const c of challenges) {
    if (completedSet.has(String(c._id))) currentStreak += 1;
    else break;
  }

  let longestStreak = 0;
  let running = 0;
  for (let i = challenges.length - 1; i >= 0; i--) {
    if (completedSet.has(String(challenges[i]._id))) {
      running += 1;
      longestStreak = Math.max(longestStreak, running);
    } else {
      running = 0;
    }
  }

  return { currentStreak, longestStreak };
}

// Batch version of computeStreak for a leaderboard: one query for the challenge timeline and one
// query for every relevant progress row, instead of computeStreak's two queries per user.
async function computeStreaksForUsers(userIds) {
  const uniqueUserIds = [...new Set(userIds.map((id) => String(id)))];
  const streakByUserId = new Map(uniqueUserIds.map((id) => [id, { currentStreak: 0, longestStreak: 0 }]));

  const challenges = await DailyChallenge.find({ status: { $in: ['published', 'archived'] } })
    .select('_id publishedAt')
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

  const completedByUser = new Map(); // userId -> Set(challengeId)
  completedProgress.forEach((p) => {
    const key = String(p.userId);
    if (!completedByUser.has(key)) completedByUser.set(key, new Set());
    completedByUser.get(key).add(String(p.challengeId));
  });

  uniqueUserIds.forEach((userId) => {
    const completedSet = completedByUser.get(userId) || new Set();

    let currentStreak = 0;
    for (const c of challenges) {
      if (completedSet.has(String(c._id))) currentStreak += 1;
      else break;
    }

    let longestStreak = 0;
    let running = 0;
    for (let i = challenges.length - 1; i >= 0; i--) {
      if (completedSet.has(String(challenges[i]._id))) {
        running += 1;
        longestStreak = Math.max(longestStreak, running);
      } else {
        running = 0;
      }
    }

    streakByUserId.set(userId, { currentStreak, longestStreak });
  });

  return streakByUserId;
}

module.exports = {
  CHALLENGE_DURATION_MS,
  MAX_ATTEMPTS,
  REQUIRED_QUESTION_COUNT,
  REMINDER_AFTER_MS,
  ENDING_SOON_WINDOW_MS,
  AttemptLimitError,
  getUtcDateKey,
  buildQuestionSnapshot,
  stripForAttempt,
  revealForAttempt,
  getHardExpiryMs,
  computeRevealState,
  consumeAttemptSlot,
  scoreAgainstSnapshot,
  createNotificationOnce,
  maybeCreateReminders,
  computeStreak,
  computeStreaksForUsers,
};
