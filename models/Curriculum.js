const mongoose = require('mongoose');

const curriculumSchema = new mongoose.Schema({
  unit: String,
  topic: String,
  subtopic: String,
  order: Number
});

module.exports = mongoose.model('Curriculum', curriculumSchema, 'curriculums');
