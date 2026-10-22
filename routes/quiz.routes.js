const express=require('express');
const router=express.Router();
const quiz=require('../controllers/quiz.controller');
const auth=require('../middleware/auth.middleware');

router.get('/practice',auth,quiz.getPracticeQuestions);
router.get('/practice/lesson',auth,quiz.getPracticeLesson);
router.post('/practice/progress',auth,quiz.savePracticeProgress);
router.get('/topic/:topicId',auth,quiz.getQuiz);
router.get('/subtopic/:subtopicId',auth,quiz.getQuizBySubtopic);
router.post('/try',auth,quiz.recordTry);
router.post('/submit',auth,quiz.submitQuiz);

module.exports=router;
