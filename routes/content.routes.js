const express=require('express');

const router=express.Router();
const content=require('../controllers/content.controller');
const auth=require('../middleware/auth.middleware');

router.get('/path',auth,content.getLearningPath);
router.get('/next-lesson',auth,content.getNextLesson);
router.get('/units',content.getUnits);
router.get('/topics/:unitId',content.getTopics);
router.get('/subtopics/:topicId',content.getSubtopics);

module.exports=router;
