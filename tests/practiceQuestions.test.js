const test = require('node:test');
const assert = require('node:assert/strict');
const { mixPracticeQuestions } = require('../utils/practiceQuestions');

test('mixPracticeQuestions keeps every question when there are fewer than the limit', () => {
    const mixed = mixPracticeQuestions([[{ _id: 1 }, { _id: 2 }], [{ _id: 3 }]], 100);
    assert.deepEqual(mixed.map((q) => q._id).sort(), [1, 2, 3]);
});

test('mixPracticeQuestions caps the result at the limit without repeating a question', () => {
    const lists = [Array.from({ length: 80 }, (_, i) => ({ _id: i })), Array.from({ length: 80 }, (_, i) => ({ _id: 100 + i }))];
    const mixed = mixPracticeQuestions(lists, 100);
    assert.equal(mixed.length, 100);
    assert.equal(new Set(mixed.map((q) => q._id)).size, 100);
});

test('mixPracticeQuestions handles empty lists', () => {
    assert.deepEqual(mixPracticeQuestions([[], []], 100), []);
});
