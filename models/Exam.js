const mongoose = require('mongoose');

const examSchema = new mongoose.Schema({
  name: String
}, { timestamps: true });

module.exports = mongoose.model('Exam', examSchema, 'Exams');
