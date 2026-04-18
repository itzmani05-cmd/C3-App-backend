const mongoose = require('mongoose');

const topicSchema = new mongoose.Schema({
  unitId: mongoose.Schema.Types.ObjectId,
  name: String,
  order: Number,
  isActive: Boolean,
  createdAt: Date
});

module.exports = mongoose.model('Topic', topicSchema);