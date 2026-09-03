const mongoose = require('mongoose');

const unitSchema = new mongoose.Schema({
  examId: mongoose.Schema.Types.ObjectId,
  name: String,
  order: Number,
  isActive: Boolean,
  createdAt: Date
});

module.exports = mongoose.model('Unit', unitSchema);