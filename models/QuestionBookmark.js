const mongoose = require('mongoose');

// A question a student marked because they had a doubt or could not solve it yet. One document per student and question.
// `source` says which collection the question lives in; the lesson fields only say where it was bookmarked from.
const questionBookmarkSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true },
  questionId: { type: mongoose.Schema.Types.ObjectId, required: true },
  source: { type: String, enum: ['question', 'practice'], required: true },
  topicId: mongoose.Schema.Types.ObjectId,
  subtopicId: mongoose.Schema.Types.ObjectId,
  lessonName: String,
  createdAt: { type: Date, default: Date.now },
});

questionBookmarkSchema.index({ userId: 1, questionId: 1 }, { unique: true });
questionBookmarkSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('QuestionBookmark', questionBookmarkSchema);
