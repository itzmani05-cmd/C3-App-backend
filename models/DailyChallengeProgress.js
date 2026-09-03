const mongoose = require('mongoose');

const dailyChallengeProgressSchema = new mongoose.Schema({
  challengeId: mongoose.Schema.Types.ObjectId,
  userId: mongoose.Schema.Types.ObjectId,

  attemptsSubmitted: { type: Number, default: 0 },
  bestScore: Number,
  bestPercentage: Number,

  lastAttemptAt: Date,
  createdAt: { type: Date, default: Date.now },
});

dailyChallengeProgressSchema.index({ challengeId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('DailyChallengeProgress', dailyChallengeProgressSchema);
