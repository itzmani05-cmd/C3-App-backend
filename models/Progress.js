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

// Every learning-path request loads a student's progress, and each submit updates one lesson's document.
progressSchema.index({ userId: 1, subtopicId: 1, topicId: 1 });

module.exports = mongoose.model('progresses', progressSchema);
