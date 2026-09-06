const express = require('express');
const router = express.Router();

const auth = require('../middleware/auth.middleware');
const controller = require('../controllers/dailyChallenge.controller');

router.use(auth);

router.get('/today', controller.getToday);
router.get('/history', controller.getHistory);
router.get('/progress-summary', controller.getProgressSummary);
router.get('/streak-history', controller.getStreakHistory);
router.get('/topic-performance', controller.getTopicPerformance);
router.get('/leaderboard', controller.getLeaderboard);
router.get('/units', controller.getUnitsWithProgress);
router.get('/units/:unitId/history', controller.getUnitHistory);
router.post('/:challengeId/start', controller.startAttempt);
router.post('/:challengeId/attempts/:attemptId/submit', controller.submitAttempt);
router.get('/:challengeId/attempts/:attemptId', controller.getAttempt);

module.exports = router;
