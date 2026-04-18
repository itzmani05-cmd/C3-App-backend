const mongoose = require('mongoose');

const subtopicSchema = new mongoose.Schema({
  topicId: mongoose.Schema.Types.ObjectId,
  name: String,
  order: Number,
  unlockRequirement: Number,
  isActive: Boolean,
  createdAt: Date
});

module.exports = mongoose.model('Subtopic', subtopicSchema);