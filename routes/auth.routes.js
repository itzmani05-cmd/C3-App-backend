const express=require('express');
const router=express.Router();
const auth=require('../controllers/auth.controller');
const requireAuth=require('../middleware/auth.middleware');

router.post('/login',auth.login);
router.post('/change-password',requireAuth,auth.changePassword);

module.exports=router;
