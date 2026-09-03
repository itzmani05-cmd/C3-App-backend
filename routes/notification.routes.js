const express = require('express');
const router = express.Router();

const auth = require('../middleware/auth.middleware');
const controller = require('../controllers/notification.controller');

router.use(auth);

router.get('/', controller.list);
router.get('/unread-count', controller.getUnreadCount);
router.post('/:id/read', controller.markRead);
router.post('/read-all', controller.markAllRead);

module.exports = router;
