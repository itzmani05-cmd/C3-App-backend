const mongoose = require('mongoose');

const questionSchema = new mongoose.Schema({
  unitId: mongoose.Schema.Types.ObjectId,
  topicId:mongoose.Schema.Types.ObjectId,
  subtopicId: mongoose.Schema.Types.ObjectId,
  type: String,
  questionText: String,
  question: String,
  questionImage: String,
  options: mongoose.Schema.Types.Mixed,
  optionImages: mongoose.Schema.Types.Mixed,
  correctAnswer: mongoose.Schema.Types.Mixed,
  correct_answer: String,
  explanation: String,
  explanationImage: String,
  status: String,
  difficultyLevel: String,
  questionType: String,
  is_published: Boolean,
  isPublished: Boolean,
  isActive: Boolean,
  isVerified: Boolean,
  createdAt: Date,
  timestamp: Date,
});

questionSchema.index({
    unitId: 1,
    topicId: 1,
    subtopicId: 1
});

module.exports = mongoose.model('Question', questionSchema);
