const mongoose = require('mongoose');

const unitSchema = new mongoose.Schema({
  name: String,
  order: Number,
  isActive: Boolean,
  createdAt: Date
});

module.exports = mongoose.model('Unit', unitSchema);