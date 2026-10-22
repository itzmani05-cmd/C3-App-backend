const mongoose = require('mongoose');
const cache = require('memory-cache');
const Question = require('../models/Question');
const PracticeQuestion = require('../models/PracticeQuestion');
const PracticeProgress = require('../models/PracticeProgress');
const { getLessonKey } = require('./lessonKey');

const COUNTS_TTL_MS = 60 * 1000;
const STUDENT_VISIBLE_QUESTION = { status: { $nin: ['pending', 'rejected'] } };

// How many questions each lesson has, keyed like the learning path: `quiz` are the app's own questions (what a quiz
// draws from) and `admin` are the admin site's practice questions, which belong to a topic. Shared by every student, so
// it is kept briefly.
async function getQuestionCounts() {
  const cached = cache.get('practice_question_counts');
  if (cached) return cached;

  const [own, admin] = await Promise.all([
    Question.aggregate([
      { $match: STUDENT_VISIBLE_QUESTION },
      { $group: { _id: { topicId: '$topicId', subtopicId: '$subtopicId' }, count: { $sum: 1 } } },
    ]),
    PracticeQuestion.aggregate([{ $group: { _id: '$topicId', count: { $sum: 1 } } }]),
  ]);

  const counts = { quiz: {}, admin: {} };
  own.forEach((row) => {
    // A question with a subtopic counts for that lesson; the topic is a lesson only when it has no subtopics.
    const key = row._id.subtopicId
      ? getLessonKey({ subtopicId: row._id.subtopicId })
      : getLessonKey({ topicId: row._id.topicId });
    if (key) counts.quiz[key] = (counts.quiz[key] || 0) + row.count;
  });
  admin.forEach((row) => {
    const key = getLessonKey({ topicId: row._id });
    if (key) counts.admin[key] = (counts.admin[key] || 0) + row.count;
  });

  cache.put('practice_question_counts', counts, COUNTS_TTL_MS);
  return counts;
}

// How many questions a student has practised in each lesson.
async function getPracticedCounts(userId) {
  if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) return {};
  const rows = await PracticeProgress.aggregate([
    { $match: { userId: new mongoose.Types.ObjectId(String(userId)) } },
    { $project: { lessonKey: 1, count: { $size: { $ifNull: ['$practicedIds', []] } } } },
  ]);
  return Object.fromEntries(rows.map((row) => [row.lessonKey, row.count]));
}

module.exports = { getQuestionCounts, getPracticedCounts };
