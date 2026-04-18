const mongoose = require('mongoose');

const progressSchema = new mongoose.Schema({
  userId: mongoose.Schema.Types.ObjectId,
  topicId: mongoose.Schema.Types.ObjectId,
  subtopicId: mongoose.Schema.Types.ObjectId,
  bestScore: Number,
  isUnlocked: Boolean,
  isCleared: Boolean,
  isMastered: Boolean,
  lastAttempted: Date
});

module.exports = mongoose.model('progresses', progressSchema);
