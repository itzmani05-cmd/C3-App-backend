const mongoose = require('mongoose');
const { NOTIFICATION_TYPE_KEYS } = require('../services/notificationTypes');

const pushSchema = new mongoose.Schema(
  {
    status: { type: String, enum: ['pending', 'sent', 'delivered', 'failed', 'skipped'], default: 'pending' },
    ticketId: String,
    to: String,
    error: String,
    attempts: { type: Number, default: 0 },
    lockedUntil: Date,
    sentAt: Date,
    receiptCheckedAt: Date,
  },
  { _id: false }
);

const notificationSchema = new mongoose.Schema({
  userId: mongoose.Schema.Types.ObjectId,
  type: {
    type: String,
    enum: NOTIFICATION_TYPE_KEYS,
  },
  title: String,
  message: String,
  data: { type: mongoose.Schema.Types.Mixed, default: undefined },
  dailyChallengeId: mongoose.Schema.Types.ObjectId,
  dedupeKey: String,
  push: { type: pushSchema, default: undefined },
  read: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

notificationSchema.index({ userId: 1, createdAt: -1 });

notificationSchema.index(
  { userId: 1, dailyChallengeId: 1, type: 1 },
  { unique: true, partialFilterExpression: { dailyChallengeId: { $type: 'objectId' } } }
);

notificationSchema.index(
  { userId: 1, dedupeKey: 1 },
  { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } }
);

notificationSchema.index({ 'push.status': 1, createdAt: 1 }, { partialFilterExpression: { 'push.status': { $exists: true } } });

module.exports = mongoose.model('Notification', notificationSchema);
