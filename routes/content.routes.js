const express=require('express');

const router=express.Router();
const content=require('../controllers/content.controller');

router.get('/path',content.getLearningPath);
router.get('/next-lesson',content.getNextLesson);
router.get('/units',content.getUnits);
router.get('/topics/:unitId',content.getTopics);
router.get('/subtopics/:topicId',content.getSubtopics);

module.exports=router;
