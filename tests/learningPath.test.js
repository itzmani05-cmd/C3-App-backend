const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const cache = require('memory-cache');

const Unit = require('../models/Unit');
const Topic = require('../models/Topic');
const Subtopic = require('../models/Subtopic');
const Progress = require('../models/Progress');
const Question = require('../models/Question');
const PracticeQuestion = require('../models/PracticeQuestion');
const PracticeProgress = require('../models/PracticeProgress');
const { getLearningPathForUser, applyProgressToTree } = require('../utils/learningPath');

const id = () => new mongoose.Types.ObjectId();
const unitId = id();
const topicId = id();
const lessonA = id();
const lessonB = id();

function stub(model, rows, counter) {
  model.find = () => {
    counter.count += 1;
    return { lean: async () => rows };
  };
}

// Both lessons have 10 quiz questions unless a test says otherwise.
function setup(progressRows, { quizRows, adminRows = [], practicedRows = [] } = {}) {
  cache.clear();
  const counters = { unit: { count: 0 }, topic: { count: 0 }, subtopic: { count: 0 } };
  stub(Unit, [{ _id: unitId, name: 'Unit 1', order: 1 }], counters.unit);
  stub(Topic, [{ _id: topicId, unitId, name: 'Topic 1', order: 1 }], counters.topic);
  stub(
    Subtopic,
    [
      { _id: lessonA, topicId, name: 'Lesson A', order: 1 },
      { _id: lessonB, topicId, name: 'Lesson B', order: 2 },
    ],
    counters.subtopic
  );
  Progress.find = () => ({ lean: async () => progressRows });
  Question.aggregate = async () =>
    quizRows ?? [
      { _id: { topicId, subtopicId: lessonA }, count: 10 },
      { _id: { topicId, subtopicId: lessonB }, count: 10 },
    ];
  PracticeQuestion.aggregate = async () => adminRows;
  PracticeProgress.aggregate = async () => practicedRows;
  return counters;
}

test('the content tree is loaded once and reused across requests', async () => {
  const counters = setup([]);
  await getLearningPathForUser(id());
  await getLearningPathForUser(id());
  await getLearningPathForUser(id());
  assert.equal(counters.unit.count, 1);
  assert.equal(counters.topic.count, 1);
  assert.equal(counters.subtopic.count, 1);
});

test("one student's progress never leaks into another's path through the shared tree", async () => {
  setup([{ subtopicId: lessonA, isCleared: true, bestScore: 90 }]);
  const withProgress = await getLearningPathForUser(id());

  Progress.find = () => ({ lean: async () => [] });
  const fresh = await getLearningPathForUser(id());

  const unlocked = (path) => path.lessons.map((lesson) => lesson.isUnlocked);
  assert.deepEqual(unlocked(withProgress), [true, true], 'clearing lesson A unlocks lesson B');
  assert.deepEqual(unlocked(fresh), [true, false], 'a new student only has the first lesson open');
  assert.equal(withProgress.lessons[0].bestScore, 90);
  assert.equal(fresh.lessons[0].bestScore, 0);
});

test('different exams are cached separately', async () => {
  const counters = setup([]);
  await getLearningPathForUser(id(), { examId: String(id()) });
  await getLearningPathForUser(id(), { examId: String(id()) });
  assert.equal(counters.unit.count, 2);
});

const unlockedOf = (path) => path.lessons.map((lesson) => lesson.isUnlocked);

test('a lesson with no questions at all does not block the next lesson', async () => {
  setup([], { quizRows: [{ _id: { topicId, subtopicId: lessonB }, count: 10 }] });
  const path = await getLearningPathForUser(id());
  assert.deepEqual(unlockedOf(path), [true, true]);
  assert.equal(path.lessons[0].isEmpty, true);
  assert.equal(path.lessons[0].isCleared, false, 'an empty lesson is skipped, not shown as done');
});

test('a lesson with a quiz still has to be cleared before the next one opens', async () => {
  setup([]);
  const path = await getLearningPathForUser(id());
  assert.deepEqual(unlockedOf(path), [true, false]);
});

test('practising most of a lesson that has practice questions but no quiz clears it', () => {
  const lesson = (key) => ({ key, unitId: 'u', type: 'topic' });
  const tree = { units: [], lessons: [lesson('topic:practice-only'), lesson('topic:with-quiz')] };
  const counts = (practiced) => ({
    quiz: { 'topic:with-quiz': 10 },
    admin: { 'topic:practice-only': 10 },
    practiced: { 'topic:practice-only': practiced },
  });

  const short = applyProgressToTree(tree, [], counts(7));
  assert.deepEqual(unlockedOf(short), [true, false], '7 of 10 is not enough');
  assert.equal(short.lessons[0].isCleared, false);

  const enough = applyProgressToTree(tree, [], counts(8));
  assert.deepEqual(unlockedOf(enough), [true, true], '8 of 10 clears it');
  assert.equal(enough.lessons[0].isCleared, true);
});

test('without question counts the old rules apply', () => {
  const tree = { units: [], lessons: [{ key: 'topic:a', unitId: 'u' }, { key: 'topic:b', unitId: 'u' }] };
  assert.deepEqual(unlockedOf(applyProgressToTree(tree, [], null)), [true, false]);
});
