const mongoose = require('mongoose');

const dailyQuestionSchema = new mongoose.Schema({
  date: String,
  type: String,
  answerType: String,
  question: String,
  questionImage: String,
  options: {
    a: String,
    b: String,
    c: String,
    d: String
  },
  optionImages: {
    a: String,
    b: String,
    c: String,
    d: String
  },
  correct_answer: mongoose.Schema.Types.Mixed,
  explanation: String,
  explanationImage: String
}, { timestamps: true });

dailyQuestionSchema.index({ date: 1 });

module.exports = mongoose.model('DailyQuestion', dailyQuestionSchema, 'DailyQuestions');
