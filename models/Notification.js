const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  userId: mongoose.Schema.Types.ObjectId,
  type: {
    type: String,
    enum: ['daily_challenge_published', 'daily_challenge_reminder', 'daily_challenge_ending_soon'],
  },
  title: String,
  message: String,
  dailyChallengeId: mongoose.Schema.Types.ObjectId,
  read: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

notificationSchema.index({ userId: 1, createdAt: -1 });

// Prevents duplicate reminders/publish-notices for the same user+challenge+type
// (e.g. two "ending soon" reminders, or a publish notice sent twice).
notificationSchema.index(
  { userId: 1, dailyChallengeId: 1, type: 1 },
  { unique: true, partialFilterExpression: { dailyChallengeId: { $type: 'objectId' } } }
);

module.exports = mongoose.model('Notification', notificationSchema);
