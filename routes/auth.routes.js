const express=require('express');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const router=express.Router();
const auth=require('../controllers/auth.controller');
const requireAuth=require('../middleware/auth.middleware');

// Only failed logins count, so students sharing one IP (a classroom) are not locked out. Limited per account and IP,
// plus a looser per-IP cap against one address trying many accounts.
const failedLoginOptions={
    windowMs:15*60*1000,
    skipSuccessfulRequests:true,
    standardHeaders:true,
    legacyHeaders:false,
    message:{message:"Too many failed login attempts. Please try again after 15 minutes."}
};
const loginAccountLimiter=rateLimit({
    ...failedLoginOptions,
    limit:8,
    keyGenerator:(req)=>`${ipKeyGenerator(req.ip)}|${String(req.body?.email || '').trim().toLowerCase()}`
});
const loginIpLimiter=rateLimit({...failedLoginOptions,limit:100,keyGenerator:(req)=>ipKeyGenerator(req.ip)});

router.post('/login',loginIpLimiter,loginAccountLimiter,auth.login);
router.post('/change-password',requireAuth,auth.changePassword);

module.exports=router;
