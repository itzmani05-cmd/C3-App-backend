const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getCorrectOptionIndex,
  getCorrectOptionIndexes,
  isNumericalAnswerCorrect,
  normalizeQuestion,
} = require('../utils/questionFormat');

test('letter answers map to the matching keyed option', () => {
  const question = { options: { A: 'one', B: 'two', C: 'three' }, correctAnswer: 'B' };
  assert.equal(getCorrectOptionIndex(question), 1);
});

test('letter answers work for plain array options', () => {
  assert.equal(getCorrectOptionIndex({ options: ['x', 'y', 'z'], correctAnswer: 'c' }), 2);
});

test('an answer that matches option text is found', () => {
  assert.equal(getCorrectOptionIndex({ options: ['red', 'green'], correctAnswer: 'green' }), 1);
});

test('an unknown answer gives -1', () => {
  assert.equal(getCorrectOptionIndex({ options: ['a', 'b'], correctAnswer: 'zzz' }), -1);
  assert.equal(getCorrectOptionIndex({ options: [], correctAnswer: 'a' }), -1);
});

test('multiple-answer questions resolve every correct index, sorted and de-duplicated', () => {
  const question = { options: { A: '1', B: '2', C: '3', D: '4' }, correctAnswer: ['D', 'B', 'B'] };
  assert.deepEqual(getCorrectOptionIndexes(question), [1, 3]);
});

test('numerical answers compare by value, ignoring formatting', () => {
  assert.equal(isNumericalAnswerCorrect('5.0', '5'), true);
  assert.equal(isNumericalAnswerCorrect(' 12 ', '12'), true);
  assert.equal(isNumericalAnswerCorrect('12', '13'), false);
});

test('non-numeric answers compare case-insensitively; blanks never match', () => {
  assert.equal(isNumericalAnswerCorrect('Paris', 'paris'), true);
  assert.equal(isNumericalAnswerCorrect('', ''), false);
  assert.equal(isNumericalAnswerCorrect('5', ''), false);
});

test('normalizeQuestion keeps the question usable for the client', () => {
  const normalized = normalizeQuestion({
    _id: 'q1',
    questionText: 'Pick B',
    options: { A: 'one', B: 'two' },
    correctAnswer: 'B',
    explanation: 'Because.',
  });
  assert.equal(normalized._id, 'q1');
  assert.equal(normalized.explanation, 'Because.');
  assert.equal(normalized.options.length, 2);
});

test('stripAnswers removes everything that gives the answer away', () => {
  const { stripAnswers } = require('../utils/questionFormat');
  const full = normalizeQuestion({
    _id: 'q1',
    questionText: 'Pick B',
    options: [{ text: 'one', isCorrect: false }, { text: 'two', isCorrect: true }],
    correctAnswer: 1,
    correct_answer: 'B',
    explanation: 'Because B.',
    explanationImage: 'http://img',
  });
  const safe = stripAnswers(full);

  for (const field of ['correctAnswer', 'correct_answer', 'correctOptionIndexes', 'numericalAnswer', 'explanation', 'explanationImage']) {
    assert.equal(field in safe, false, `${field} should be removed`);
  }
  assert.ok(safe.options.every((option) => !('isCorrect' in option)));
  assert.equal(safe.questionText, 'Pick B');
  assert.equal(safe.options[1].text, 'two');
  assert.equal(JSON.stringify(safe).includes('Because B'), false);
});
