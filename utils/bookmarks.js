const mongoose = require('mongoose');

const MAX_BOOKMARKS = 300;
const MAX_LESSON_NAME_LENGTH = 120;

const isObjectId = (value) => typeof value === 'string' && mongoose.Types.ObjectId.isValid(value) && String(new mongoose.Types.ObjectId(value)) === value;

// Where the student bookmarked the question from. Nothing here is required: a bad id or name is dropped rather than
// stopping the bookmark from being saved.
function cleanBookmarkContext(body = {}) {
  return {
    topicId: isObjectId(body.topicId) ? body.topicId : null,
    subtopicId: isObjectId(body.subtopicId) ? body.subtopicId : null,
    lessonName: typeof body.lessonName === 'string' ? body.lessonName.trim().slice(0, MAX_LESSON_NAME_LENGTH) : '',
  };
}

// The saved questions in the order the student bookmarked them (newest first), each with the question itself and where it
// came from. Bookmarks whose question has since been removed are left out.
function joinBookmarks(bookmarks, questions) {
  const byId = new Map(questions.map((question) => [String(question._id), question]));
  return bookmarks
    .filter((bookmark) => byId.has(String(bookmark.questionId)))
    .map((bookmark) => ({
      ...byId.get(String(bookmark.questionId)),
      bookmarkedAt: bookmark.createdAt,
      topicId: bookmark.topicId || byId.get(String(bookmark.questionId)).topicId || null,
      subtopicId: bookmark.subtopicId || byId.get(String(bookmark.questionId)).subtopicId || null,
      lessonName: bookmark.lessonName || '',
    }));
}

module.exports = { MAX_BOOKMARKS, MAX_LESSON_NAME_LENGTH, cleanBookmarkContext, joinBookmarks };
