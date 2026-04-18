const express = require('express');
const router = express.Router();

const auth = require('../middleware/auth.middleware');
const user = require('../controllers/user.controller');

router.get('/profile', auth, user.getProfile);
router.get('/dashboard', auth, user.getDashboard);

module.exports = router;
