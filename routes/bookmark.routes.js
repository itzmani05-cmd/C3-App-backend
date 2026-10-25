const express = require('express');
const router = express.Router();

const auth = require('../middleware/auth.middleware');
const bookmark = require('../controllers/bookmark.controller');

router.get('/', auth, bookmark.getBookmarks);
router.get('/ids', auth, bookmark.getBookmarkIds);
router.put('/:questionId', auth, bookmark.addBookmark);
router.delete('/:questionId', auth, bookmark.removeBookmark);

module.exports = router;
