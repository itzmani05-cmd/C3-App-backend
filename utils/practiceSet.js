const mongoose = require('mongoose');
const Question = require('../models/Question');
const PracticeQuestion = require('../models/PracticeQuestion');
const PracticeProgress = require('../models/PracticeProgress');
const { normalizeQuestion } = require('./questionFormat');
const { getLessonKey } = require('./lessonKey');

const PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 50;
const STUDENT_VISIBLE_QUESTION = { status: { $nin: ['pending', 'rejected'] } };

// A student's place in a lesson can only be a question that exists.
function clampPosition(position, total) {
  const number = Math.floor(Number(position));
  if (!Number.isFinite(number) || number < 0 || total <= 0) return 0;
  return Math.min(number, total - 1);
}

function pageRange(offset, limit, total) {
  const size = Math.min(Math.max(Math.floor(Number(limit)) || PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const start = clampPosition(offset, total);
  return { start, end: Math.min(start + size, total) };
}

// Practised ids that still belong to the lesson, so removed questions do not count towards "x of y".
function countPracticed(practicedIds, entries) {
  const current = new Set(entries.map((entry) => String(entry._id)));
  return [...new Set((practicedIds || []).map(String))].filter((id) => current.has(id)).length;
}

// Every question of a lesson in a fixed order (the app's own questions, then the admin's practice questions, each by
// id), so "question 12 of 30" means the same question every time and a saved position can be resumed.
async function getLessonEntries(idField, id) {
  const lessonId = new mongoose.Types.ObjectId(id);
  const [own, admin] = await Promise.all([
    Question.find({ [idField]: lessonId, ...STUDENT_VISIBLE_QUESTION }).select('_id').sort({ _id: 1 }).lean(),
    // Practice questions belong to a topic, never a subtopic.
    idField === 'topicId' ? PracticeQuestion.find({ topicId: lessonId }).select('_id').sort({ _id: 1 }).lean() : [],
  ]);
  return [
    ...own.map((doc) => ({ _id: doc._id, source: 'question' })),
    ...admin.map((doc) => ({ _id: doc._id, source: 'practice' })),
  ];
}

async function loadEntries(entries) {
  const idsOf = (source) => entries.filter((entry) => entry.source === source).map((entry) => entry._id);
  const [own, admin] = await Promise.all([
    Question.find({ _id: { $in: idsOf('question') } }).lean(),
    PracticeQuestion.find({ _id: { $in: idsOf('practice') } }).lean(),
  ]);
  const byId = new Map([...own, ...admin].map((doc) => [String(doc._id), doc]));
  return entries.map((entry) => byId.get(String(entry._id))).filter(Boolean).map((doc) => normalizeQuestion(doc));
}

async function loadLessonProgress(userId, lessonKey) {
  return PracticeProgress.findOne({ userId, lessonKey }).lean();
}

// Adds `questionCount` (quiz + admin practice questions), `quizQuestionCount` and `practicedCount` to every lesson of
// the learning-path units (a topic with subtopics gets the totals of its subtopics). Returns new objects and leaves its
// input alone.
function addPracticeInfo(units, counts, practiced) {
  const lessonInfo = (key) => {
    const quizQuestionCount = counts.quiz[key] || 0;
    const questionCount = quizQuestionCount + (counts.admin[key] || 0);
    return { questionCount, quizQuestionCount, practicedCount: Math.min(practiced[key] || 0, questionCount) };
  };
  const total = (items, field) => items.reduce((sum, item) => sum + item[field], 0);

  return (units || []).map((unit) => ({
    ...unit,
    topics: (unit.topics || []).map((topic) => {
      if (Array.isArray(topic.subtopics) && topic.subtopics.length > 0) {
        const subtopics = topic.subtopics.map((subtopic) => ({ ...subtopic, ...lessonInfo(subtopic.key) }));
        return {
          ...topic,
          subtopics,
          questionCount: total(subtopics, 'questionCount'),
          quizQuestionCount: total(subtopics, 'quizQuestionCount'),
          practicedCount: total(subtopics, 'practicedCount'),
        };
      }
      return { ...topic, ...lessonInfo(topic.key) };
    }),
  }));
}

module.exports = {
  PAGE_SIZE,
  clampPosition,
  pageRange,
  countPracticed,
  getLessonEntries,
  loadEntries,
  loadLessonProgress,
  addPracticeInfo,
};
