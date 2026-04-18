const mongoose = require('mongoose');

const quizSchema = new mongoose.Schema({
  subtopicId: mongoose.Schema.Types.ObjectId,
  totalQuestions: Number,
  timeLimit: Number,
  isActive: Boolean,
  createdAt: Date
});

module.exports = mongoose.model('Quiz', quizSchema);