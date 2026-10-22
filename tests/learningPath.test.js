const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const cache = require('memory-cache');

const Unit = require('../models/Unit');
const Topic = require('../models/Topic');
const Subtopic = require('../models/Subtopic');
const Progress = require('../models/Progress');
const { getLearningPathForUser } = require('../utils/learningPath');

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

function setup(progressRows) {
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
