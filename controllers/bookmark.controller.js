const mongoose = require('mongoose');
const Question = require('../models/Question');
const PracticeQuestion = require('../models/PracticeQuestion');
const QuestionBookmark = require('../models/QuestionBookmark');
const { loadEntries } = require('../utils/practiceSet');
const { MAX_BOOKMARKS, cleanBookmarkContext, joinBookmarks } = require('../utils/bookmarks');

const STUDENT_VISIBLE_QUESTION = { status: { $nin: ['pending', 'rejected'] } };

// Which collection a question is in, or null when it does not exist (or the student may not see it).
async function findQuestionSource(questionId) {
  if (await Question.exists({ _id: questionId, ...STUDENT_VISIBLE_QUESTION })) return 'question';
  if (await PracticeQuestion.exists({ _id: questionId })) return 'practice';
  return null;
}

// Just the ids, so a lesson can show which of its questions are already bookmarked.
exports.getBookmarkIds = async (req, res) => {
  try {
    const bookmarks = await QuestionBookmark.find({ userId: req.userId }).select('questionId').lean();
    res.json({ ids: bookmarks.map((bookmark) => String(bookmark.questionId)) });
  } catch (err) {
    console.error('GET BOOKMARK IDS ERROR:', err);
    res.status(500).json({ message: 'Error fetching saved questions' });
  }
};

// The saved questions themselves, newest first.
exports.getBookmarks = async (req, res) => {
  try {
    const bookmarks = await QuestionBookmark.find({ userId: req.userId }).sort({ createdAt: -1 }).limit(MAX_BOOKMARKS).lean();
    const questions = await loadEntries(bookmarks.map((bookmark) => ({ _id: bookmark.questionId, source: bookmark.source })));
    res.json({ questions: joinBookmarks(bookmarks, questions), limit: MAX_BOOKMARKS });
  } catch (err) {
    console.error('GET BOOKMARKS ERROR:', err);
    res.status(500).json({ message: 'Error fetching saved questions' });
  }
};

// Saving a question twice is harmless: the second call only refreshes where it was saved from.
exports.addBookmark = async (req, res) => {
  const { questionId } = req.params;
  const userId = req.userId;

  try {
    if (!mongoose.Types.ObjectId.isValid(questionId)) return res.status(400).json({ message: 'A valid question is required' });

    const source = await findQuestionSource(questionId);
    if (!source) return res.status(404).json({ message: 'Question not found' });

    const alreadySaved = await QuestionBookmark.exists({ userId, questionId });
    if (!alreadySaved && (await QuestionBookmark.countDocuments({ userId })) >= MAX_BOOKMARKS) {
      return res.status(400).json({ message: `You can save up to ${MAX_BOOKMARKS} questions. Remove one to save another.` });
    }

    await QuestionBookmark.findOneAndUpdate(
      { userId, questionId },
      { $set: { source, ...cleanBookmarkContext(req.body) }, $setOnInsert: { createdAt: new Date() } },
      { upsert: true }
    );
    res.status(201).json({ bookmarked: true });
  } catch (err) {
    console.error('ADD BOOKMARK ERROR:', err);
    res.status(500).json({ message: 'Could not save this question. Please try again.' });
  }
};

exports.removeBookmark = async (req, res) => {
  const { questionId } = req.params;

  try {
    if (!mongoose.Types.ObjectId.isValid(questionId)) return res.status(400).json({ message: 'A valid question is required' });
    await QuestionBookmark.deleteOne({ userId: req.userId, questionId });
    res.json({ bookmarked: false });
  } catch (err) {
    console.error('REMOVE BOOKMARK ERROR:', err);
    res.status(500).json({ message: 'Could not remove this question. Please try again.' });
  }
};
