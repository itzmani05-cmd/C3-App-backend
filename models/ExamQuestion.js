const mongoose = require('mongoose');

const examQuestionSchema = new mongoose.Schema({
  unitId: mongoose.Schema.Types.ObjectId,
  topicId: mongoose.Schema.Types.ObjectId,
  subtopicId: mongoose.Schema.Types.ObjectId,
  type: String,
  question: String,
  options: {
    a: String,
    b: String,
    c: String,
    d: String
  },
  correct_answer: String,
  explanation: String,
  status: String,
  is_published: Boolean,
  timestamp: Date
});

examQuestionSchema.index({
  unitId: 1,
  topicId: 1,
  subtopicId: 1
});

module.exports = mongoose.model('ExamQuestion', examQuestionSchema, 'ExamQuestions');
