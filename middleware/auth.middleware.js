const { verifyUserToken } = require('../utils/token');

module.exports=(req,res,next)=>{
    const header=req.headers.authorization || '';
    const token=header.startsWith('Bearer ') ? header.slice(7) : null;
    const userId=token ? verifyUserToken(token) : null;

    if(!userId){
        return res.status(401).json({
            message:"Not authenticated"
        });
    }

    req.userId=userId;
    req.headers.userid=userId;
    next();
}
