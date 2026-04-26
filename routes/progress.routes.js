const express=require('express');
const router=express.Router();
const progress=require('../controllers/progress.controller');

router.get('/:userId',progress.getUserProgress);
router.get('/subtopic/:subtopicId',progress.getSubtopicStudentDetails);
router.get('/topic/:topicId', progress.getTopicStudentDetails);


module.exports=router;