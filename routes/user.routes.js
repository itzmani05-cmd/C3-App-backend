const express = require('express');
const router = express.Router();

const auth = require('../middleware/auth.middleware');
const user = require('../controllers/user.controller');

router.get('/profile', auth, user.getProfile);
router.get('/exams', auth, user.getMyExams);
router.get('/dashboard', auth, user.getDashboard);
router.post('/push-token', auth, user.savePushToken);
router.delete('/push-token', auth, user.removePushToken);

module.exports = router;
