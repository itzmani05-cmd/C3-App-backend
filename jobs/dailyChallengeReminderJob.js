// Proactively reminds students about the live Daily Challenge, so the reminder reaches them even if
// they never open the app — the per-request reminder path in dailyChallenge.controller.js only fires
// for students who happen to check in. Run on an interval from server.js; safe to run repeatedly
// since Notification's unique index dedupes both this sweep and the lazy path against each other.
const DailyChallenge = require('../models/DailyChallenge');
const DailyChallengeProgress = require('../models/DailyChallengeProgress');
const User = require('../models/User');
const { computeRevealState, maybeCreateReminders } = require('../utils/dailyChallengeHelpers');

async function runDailyChallengeReminderSweep() {
  const challenge = await DailyChallenge.findOne({ status: 'published' }).sort({ publishedAt: -1 }).lean();
  if (!challenge) return;

  const revealStateBase = computeRevealState(challenge, null);
  if (revealStateBase.expired) return; // nothing left to remind about

  const students = await User.find({
    role: 'student',
    isActive: { $ne: false },
    expoPushToken: { $exists: true, $ne: null, $nin: ['', null] },
  })
    .select('_id expoPushToken')
    .lean();
  if (!students.length) return;

  const studentIds = students.map((s) => s._id);
  const progresses = await DailyChallengeProgress.find({
    challengeId: challenge._id,
    userId: { $in: studentIds },
  })
    .select('userId attemptsSubmitted')
    .lean();
  const progressByUserId = new Map(progresses.map((p) => [String(p.userId), p]));

  for (const student of students) {
    const progress = progressByUserId.get(String(student._id)) || null;
    const revealState = computeRevealState(challenge, progress);
    try {
      await maybeCreateReminders(challenge, student._id, revealState, student.expoPushToken);
    } catch (err) {
      console.error('[dailyChallengeReminderJob] reminder error for user', String(student._id), err.message);
    }
  }
}

module.exports = { runDailyChallengeReminderSweep };
