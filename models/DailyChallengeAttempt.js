const mongoose = require('mongoose');

const dailyChallengeAttemptSchema = new mongoose.Schema({
  challengeId: mongoose.Schema.Types.ObjectId,
  userId: mongoose.Schema.Types.ObjectId,
  attemptNumber: Number,

  responses: [
    {
      questionId: mongoose.Schema.Types.ObjectId,
      selectedOptionIndex: Number,
      isCorrect: Boolean,
    },
  ],

  score: Number,
  totalQuestions: Number,
  percentage: Number,

  isSubmitted: { type: Boolean, default: false },
  isVoid: { type: Boolean, default: false },
  voidReason: String,

  startedAt: Date,
  submittedAt: Date,
});

dailyChallengeAttemptSchema.index(
  { challengeId: 1, userId: 1, attemptNumber: 1 },
  { unique: true, partialFilterExpression: { attemptNumber: { $type: 'number' } } }
);
dailyChallengeAttemptSchema.index({ challengeId: 1, userId: 1, isSubmitted: 1 });

module.exports = mongoose.model('DailyChallengeAttempt', dailyChallengeAttemptSchema);
