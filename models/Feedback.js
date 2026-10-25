const mongoose = require('mongoose');
const { CATEGORIES, QUESTION_SOURCES } = require('../utils/feedback');

// Student feedback sent from the app. The student's name and email are copied in so an inbox can list it without a lookup.
const feedbackSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  studentName: String,
  studentEmail: String,
  category: { type: String, enum: CATEGORIES, default: 'general' },
  rating: { type: Number, min: 1, max: 5, default: null },
  message: { type: String, required: true },
  // Set when the feedback was sent from a question's Report button.
  questionId: String,
  questionNumber: { type: Number, default: null },
  questionSource: { type: String, enum: [...QUESTION_SOURCES, ''], default: '' },
  questionContext: String,
  platform: String,
  appVersion: String,
  status: { type: String, enum: ['open', 'reviewed'], default: 'open' },
  reviewedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
});

feedbackSchema.index({ createdAt: -1 });
feedbackSchema.index({ status: 1, createdAt: -1 });
// Used to cap how much one student can send in an hour.
feedbackSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('Feedback', feedbackSchema);
