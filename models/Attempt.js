const mongoose = require('mongoose');

const attemptSchema = new mongoose.Schema({
  userId: mongoose.Schema.Types.ObjectId,
  quizId: mongoose.Schema.Types.ObjectId,
  questionOrder: [mongoose.Schema.Types.ObjectId],

  score: Number,
  totalQuestions: Number,
  percentage: Number,

  isExplanationUnlocked: Boolean,
  isPassed: Boolean,

  isSubmitted: Boolean,
  isTimedOut: Boolean,

  responses: [
    {
      questionId: mongoose.Schema.Types.ObjectId,
      selectedOptionIndex: Number,
      selectedOptionIndexes: [Number],
      selectedNumericalAnswer: String,
      isCorrect: Boolean,
      isMarkedForReview: Boolean
    }
  ],

  startedAt: Date,
  submittedAt: Date
}, { strict: false });

module.exports = mongoose.model('Attempt', attemptSchema);