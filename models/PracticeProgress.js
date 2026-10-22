const mongoose = require('mongoose');

// Where a student is in a lesson's practice questions, and which of them they have worked through (answered or
// revealed). One document per student and lesson; `lessonKey` is the same key the learning path uses.
const practiceProgressSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true },
  lessonKey: { type: String, required: true },
  topicId: mongoose.Schema.Types.ObjectId,
  subtopicId: mongoose.Schema.Types.ObjectId,
  practicedIds: [mongoose.Schema.Types.ObjectId],
  position: { type: Number, default: 0 },
  lastPracticedAt: Date,
});

practiceProgressSchema.index({ userId: 1, lessonKey: 1 }, { unique: true });

module.exports = mongoose.model('PracticeProgress', practiceProgressSchema);
