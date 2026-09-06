const mongoose = require('mongoose');

const examSchema = new mongoose.Schema({
  name: String,
}, { collection: 'Exams' });

module.exports = mongoose.model('Exam', examSchema);
