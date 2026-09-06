const mongoose = require('mongoose');

const dailyChallengeAttemptSchema = new mongoose.Schema({
  challengeId: mongoose.Schema.Types.ObjectId,
  userId: mongoose.Schema.Types.ObjectId,
  // Populated from the User doc at attempt-start time so this shared collection's website-defined
  // unique index on {challengeId, studentEmail, attemptNumber} scopes correctly per real student
  // instead of colliding across different mobile users (see dailyChallenge.controller.js startAttempt).
  studentEmail: String,
  attemptNumber: Number,

  responses: [
    {
      questionId: mongoose.Schema.Types.ObjectId,
      selectedOptionIndex: Number,
      selectedOptionIndexes: [Number],
      selectedNumericalAnswer: String,
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
