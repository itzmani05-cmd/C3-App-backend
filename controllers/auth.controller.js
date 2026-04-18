const User=require('../models/User');

exports.changePassword=async(req,res)=>{
    try{
        const userId=req.headers?.userid;
        const {oldPassword,newPassword}=req.body;

        if(!userId){
            return res.status(401).json({message:"Unauthorized"});
        }

        if(!oldPassword||!newPassword){
            return res.status(400).json({message:"Old password and new password are required"});
        }

        const user=await User.findById(userId);
        if(!user){
            return res.status(404).json({message:"User not found"});
        }

        if(user.password!==oldPassword){
            return res.status(400).json({message:"Old password is incorrect"});
        }

        user.password=newPassword;
        await user.save();

        res.json({message:"Password changed successfully"});
    }
    catch(err){
        console.log(err);
        res.status(500).json({message:"Error changing password"});
    }
};

exports.register=async(req,res)=>{
    try{
        const user=await User.create(req.body);
        res.json(user);
    }
    catch(err){
        console.log(err);
        res.status(500).json({message:"Error creating user"});
    }
};

exports.login=async(req,res)=>{
    try{
        const email=req.body?.email?.trim()?.toLowerCase();
        const password=req.body?.password;
        const role=req.body?.role;

        if(!email || !password){
            return res.status(400).json({message:"Email and password are required"});
        }

        const query={email,password};
        if(role){
            query.role=role;
        }

        const user=await User.findOne(query).lean();
        if(!user){
            return res.status(401).json({message:"Invalid credentials"});
        }

        if(user.isActive===false){
            return res.status(403).json({message:"This account is inactive"});
        }

        res.json({
            userId:user._id,
            name:user.name || "",
            email:user.email,
            role:user.role
        });
    }
    catch(err){
        console.log(err);
        res.status(500).json({message:"Error logging in"});
    }
};
