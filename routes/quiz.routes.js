const express=require('express');
const router=express.Router();
const quiz=require('../controllers/quiz.controller');
const auth=require('../middleware/auth.middleware');

router.get('/topic/:topicId',auth,quiz.getQuiz);
router.get('/subtopic/:subtopicId',auth,quiz.getQuizBySubtopic);
router.post('/submit',auth,quiz.submitQuiz);


module.exports=router;
