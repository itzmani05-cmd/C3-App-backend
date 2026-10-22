const test = require('node:test');
const assert = require('node:assert/strict');
const { clampPosition, pageRange, countPracticed, addPracticeInfo } = require('../utils/practiceSet');

test('clampPosition keeps a saved place inside the lesson', () => {
  assert.equal(clampPosition(5, 30), 5);
  assert.equal(clampPosition(99, 30), 29);
  assert.equal(clampPosition(-3, 30), 0);
  assert.equal(clampPosition('abc', 30), 0);
  assert.equal(clampPosition(undefined, 30), 0);
  assert.equal(clampPosition(4, 0), 0);
});

test('pageRange returns one page and never runs past the end', () => {
  assert.deepEqual(pageRange(0, 25, 100), { start: 0, end: 25 });
  assert.deepEqual(pageRange(90, 25, 100), { start: 90, end: 100 });
  assert.deepEqual(pageRange(500, 25, 100), { start: 99, end: 100 });
  assert.deepEqual(pageRange(undefined, undefined, 10), { start: 0, end: 10 });
  assert.equal(pageRange(0, 9999, 500).end, 50);
});

test('countPracticed ignores repeats and questions no longer in the lesson', () => {
  const entries = [{ _id: 'a' }, { _id: 'b' }, { _id: 'c' }];
  assert.equal(countPracticed(['a', 'a', 'b', 'gone'], entries), 2);
  assert.equal(countPracticed(undefined, entries), 0);
});

test('addPracticeInfo adds counts to lessons and totals them for topics with subtopics', () => {
  const units = [
    {
      name: 'Unit',
      topics: [
        { name: 'Direct', key: 'topic:1', subtopics: [] },
        { name: 'Split', key: 'topic:2', subtopics: [{ key: 'subtopic:a' }, { key: 'subtopic:b' }] },
      ],
    },
  ];
  const counts = { quiz: { 'topic:1': 20, 'subtopic:a': 10, 'subtopic:b': 5 }, admin: { 'topic:1': 10 } };
  const practiced = { 'topic:1': 12, 'subtopic:a': 4, 'subtopic:b': 9 };

  const [unit] = addPracticeInfo(units, counts, practiced);
  assert.deepEqual([unit.topics[0].questionCount, unit.topics[0].quizQuestionCount, unit.topics[0].practicedCount], [30, 20, 12]);
  assert.deepEqual([unit.topics[1].subtopics[0].questionCount, unit.topics[1].subtopics[0].practicedCount], [10, 4]);
  // 9 practised can never exceed the 5 questions the lesson has now.
  assert.deepEqual([unit.topics[1].subtopics[1].questionCount, unit.topics[1].subtopics[1].practicedCount], [5, 5]);
  assert.deepEqual([unit.topics[1].questionCount, unit.topics[1].practicedCount], [15, 9]);
  assert.equal(units[0].topics[0].questionCount, undefined, 'input is not changed');
});
