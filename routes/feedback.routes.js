const express = require('express');
const router = express.Router();

const auth = require('../middleware/auth.middleware');
const feedback = require('../controllers/feedback.controller');

router.post('/', auth, feedback.submitFeedback);

module.exports = router;
