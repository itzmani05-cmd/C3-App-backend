const test = require('node:test');
const assert = require('node:assert/strict');
const { validateFeedback, MAX_MESSAGE_LENGTH } = require('../utils/feedback');

const ok = (body) => validateFeedback(body).value;
const fails = (body) => validateFeedback(body).error;

test('a normal message is accepted and trimmed, with general as the default category', () => {
  const value = ok({ message: '   The quizzes are great but the timer is too short.   ' });
  assert.equal(value.message, 'The quizzes are great but the timer is too short.');
  assert.equal(value.category, 'general');
  assert.equal(value.rating, null);
});

test('messages that are missing, too short or too long are rejected', () => {
  assert.ok(fails({}));
  assert.ok(fails({ message: 'short' }));
  assert.ok(fails({ message: '          short          ' }), 'padding does not count towards the minimum');
  assert.ok(fails({ message: 'x'.repeat(MAX_MESSAGE_LENGTH + 1) }));
  assert.equal(fails({ message: 'x'.repeat(MAX_MESSAGE_LENGTH) }), undefined);
});

test('the message must be text', () => {
  assert.ok(fails({ message: 12345678901 }));
  assert.ok(fails({ message: { $gt: '' } }), 'an object (injection attempt) is not a message');
  assert.ok(fails({ message: ['a long enough message here'] }));
});

test('only known categories are accepted', () => {
  for (const category of ['general', 'bug', 'content', 'suggestion']) {
    assert.equal(ok({ message: 'A long enough message.', category }).category, category);
  }
  assert.ok(fails({ message: 'A long enough message.', category: 'spam' }));
  assert.ok(fails({ message: 'A long enough message.', category: { $ne: 'x' } }));
});

test('the rating is optional but must be a whole number from 1 to 5', () => {
  assert.equal(ok({ message: 'A long enough message.', rating: 4 }).rating, 4);
  assert.equal(ok({ message: 'A long enough message.', rating: '5' }).rating, 5);
  assert.equal(ok({ message: 'A long enough message.', rating: null }).rating, null);
  for (const rating of [0, 6, 2.5, 'great', -1]) {
    assert.ok(fails({ message: 'A long enough message.', rating }), `rating ${rating} should be rejected`);
  }
});

test('device details are kept short and ignored when they are not text', () => {
  const value = ok({ message: 'A long enough message.', platform: 'android'.repeat(10), appVersion: { x: 1 } });
  assert.equal(value.platform.length, 20);
  assert.equal(value.appVersion, '');
});
