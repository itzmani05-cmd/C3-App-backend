module.exports=(req,res,next)=>{
    const userId=req.headers.userid;
    if(!userId){
        return res.status(401).json({
            message:"Not authenticated"
        });
    }
    req.userId=userId;
    next();
}