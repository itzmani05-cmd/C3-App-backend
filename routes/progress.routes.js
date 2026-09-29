const express=require('express');
const router=express.Router();
const progress=require('../controllers/progress.controller');
const auth=require('../middleware/auth.middleware');

const ownUserOnly=(req,res,next)=>{
    if(String(req.params.userId)!==String(req.userId)){
        return res.status(403).json({message:"Not allowed"});
    }
    next();
};

router.get('/:userId',auth,ownUserOnly,progress.getUserProgress);

module.exports=router;
