const User=require('../models/User');
const { hashPassword, verifyPassword, isBcryptHash } = require('../utils/password');

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

        const oldPasswordMatches=await verifyPassword(oldPassword,user.password);
        if(!oldPasswordMatches){
            return res.status(400).json({message:"Old password is incorrect"});
        }

        user.password=await hashPassword(newPassword);
        await user.save();

        res.json({message:"Password changed successfully"});
    }
    catch(err){
        console.log(err);
        res.status(500).json({message:"Error changing password"});
    }
};

exports.login=async(req,res)=>{
    try{
        const email=req.body?.email?.trim()?.toLowerCase();
        const password=req.body?.password;

        if(!email || !password){
            return res.status(400).json({message:"Email and password are required"});
        }

        const user=await User.findOne({email,role:'student'});
        if(!user){
            return res.status(401).json({message:"Invalid credentials"});
        }

        const passwordMatches=await verifyPassword(password,user.password);
        if(!passwordMatches){
            return res.status(401).json({message:"Invalid credentials"});
        }

        if(!isBcryptHash(user.password)){
            // Migrate legacy plaintext password to a hash now that it's been verified.
            user.password=await hashPassword(password);
            await user.save();
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
