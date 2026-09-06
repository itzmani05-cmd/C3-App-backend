const mongoose = require('mongoose');

const questionSnapshotSchema = new mongoose.Schema({
  questionId: mongoose.Schema.Types.ObjectId,
  order: Number,
  questionText: String,
  questionImage: String,
  options: [mongoose.Schema.Types.Mixed],
  optionImages: [String],
  answerType: { type: String, default: 'single' },
  correctOptionIndex: Number,
  correctOptionIndexes: [Number],
  numericalAnswer: String,
  explanation: String,
  explanationImage: String,
  topicId: mongoose.Schema.Types.ObjectId,
  subtopicId: mongoose.Schema.Types.ObjectId,
}, { _id: false });

const dailyChallengeSchema = new mongoose.Schema({
  title: String,
  examId: mongoose.Schema.Types.ObjectId,
  status: { type: String, enum: ['draft', 'published', 'archived'], default: 'draft' },

  questionIds: [mongoose.Schema.Types.ObjectId],
  questionSnapshot: [questionSnapshotSchema],

  dateKey: String,
  publishedAt: Date,
  expiresAt: Date,
  earlyClosedAt: Date,

  createdBy: mongoose.Schema.Types.ObjectId,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

dailyChallengeSchema.index(
  { dateKey: 1 },
  { unique: true, partialFilterExpression: { status: 'published' } }
);
dailyChallengeSchema.index({ status: 1, publishedAt: -1 });

module.exports = mongoose.model('DailyChallenge', dailyChallengeSchema);
