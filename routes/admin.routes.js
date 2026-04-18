const express=require('express');
const router=express.Router();

const admin=require('../controllers/admin.controller');

router.post('/create-student',admin.createStudent);
router.get('/students',admin.getStudents);
router.get('/students/:id/progress',admin.getProgress);
router.delete('/students/:id',admin.deleteStudent);
router.get('/questions',admin.getQuestions);
router.post('/questions',admin.addQuestion);
router.delete('/questions/:id',admin.deleteQuestion);
router.put('/questions/:id',admin.updateQuestion);

module.exports=router;