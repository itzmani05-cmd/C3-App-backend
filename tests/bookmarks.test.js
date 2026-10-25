const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanBookmarkContext, joinBookmarks, MAX_LESSON_NAME_LENGTH } = require('../utils/bookmarks');

const ID_A = '64b7f0c2a1b2c3d4e5f60718';
const ID_B = '64b7f0c2a1b2c3d4e5f60719';

test('the lesson a question was saved from is kept when it is valid', () => {
  const context = cleanBookmarkContext({ topicId: ID_A, subtopicId: ID_B, lessonName: '  Kinematics  ' });
  assert.deepEqual(context, { topicId: ID_A, subtopicId: ID_B, lessonName: 'Kinematics' });
});

test('a bad id or name is dropped instead of failing the bookmark', () => {
  assert.deepEqual(cleanBookmarkContext({}), { topicId: null, subtopicId: null, lessonName: '' });
  const context = cleanBookmarkContext({ topicId: 'nope', subtopicId: { $ne: null }, lessonName: 'x'.repeat(500) });
  assert.equal(context.topicId, null);
  assert.equal(context.subtopicId, null);
  assert.equal(context.lessonName.length, MAX_LESSON_NAME_LENGTH);
  assert.equal(cleanBookmarkContext({ lessonName: { $gt: '' } }).lessonName, '');
});

test('saved questions come back in bookmark order, and a deleted question is left out', () => {
  const bookmarks = [
    { questionId: ID_B, createdAt: new Date('2026-02-02'), lessonName: 'Optics' },
    { questionId: '64b7f0c2a1b2c3d4e5f6071a', createdAt: new Date('2026-02-01') },
    { questionId: ID_A, createdAt: new Date('2026-01-01'), topicId: ID_A },
  ];
  const questions = [
    { _id: ID_A, questionText: 'first', topicId: 'own-topic' },
    { _id: ID_B, questionText: 'second', topicId: 'other-topic' },
  ];

  const joined = joinBookmarks(bookmarks, questions);
  assert.deepEqual(joined.map((question) => question.questionText), ['second', 'first']);
  assert.equal(joined[0].lessonName, 'Optics');
  assert.equal(joined[0].topicId, 'other-topic', "the question's own topic is used when the bookmark has none");
  assert.equal(joined[1].topicId, ID_A, 'the bookmark topic wins when it has one');
});
