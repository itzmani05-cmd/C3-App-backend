module.exports=(req,res,next)=>{
    const userId=req.headers.userid;
    if(!userId){
        console.error("[AUTH] Missing userid header");
        return res.status(401).json({
            message:"Not authenticated"
        });
    }
    req.userId=userId;
    next();
}