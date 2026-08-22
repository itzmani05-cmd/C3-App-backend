const User=require('../models/User');
const Question=require('../models/Question');
const Progress=require('../models/Progress');
const mongoose=require('mongoose');
const { normalizeQuestion } = require('../utils/questionFormat');
const { hashPassword } = require('../utils/password');

exports.createStudent=async(req,res)=>{
    try{
        const {email,password}=req.body;
        const existing=await User.findOne({email});
        if(existing){
            return res.status(400).json({message:'User already exists'});
        }
        const newUser=new User({
            email,password:await hashPassword(password),role:'student'
        });
        await newUser.save();
        res.json({
            message:"Student created successfully",
            email,password
        })
    }
    catch(err){
        console.log(err);
        res.status(500).json({
            message:"Error creating student"
        });
    }
};

exports.getStudents=async(req,res)=>{
    try{
        const students=await User.find({role:'student'});
        res.json(students);
    }
    catch(err){
        console.log(err);
        res.status(500).json({
            message:"Error fetching students"
        });
    }
};

exports.deleteStudent=async(req,res)=>{
    try{
        const deleted = await User.findByIdAndDelete(req.params.id);
        if(!deleted){
            return res.status(404).json({message:"Student not found"});
        }
        res.json({message:"Student deleted"});
    }
    catch(err){
        res.status(500).json({message:"Error deleting the student"});
    }
}

exports.getProgress=async(req,res)=>{
    try{
        const userId=req.params.id;
        const user=await User.findById(userId).select('email');
        if(!user){
            return res.status(404).json({message:"Student not found"});
        }
        const progress=await Progress.find({userId}).populate('topicId', 'name').populate('subtopicId', 'name');
        res.json({email:user.email,progress});
    }
    catch(err){
        console.log(err);
        res.status(500).json({message:"Error fetching progress"});
    }
}

exports.getQuestions=async(req,res)=>{
    try{
        const {topicId, subtopicId}=req.query;
        let filter={};
        if(subtopicId&& mongoose.Types.ObjectId.isValid(subtopicId)){
            filter.subtopicId=new mongoose.Types.ObjectId(subtopicId);
        }
        else if(topicId){
            filter.topicId=new mongoose.Types.ObjectId(topicId);
        }
        const questions=await Question.find(filter);
        res.json(questions.map((question) => normalizeQuestion(question.toObject())));
    }
    catch(err){
        res.status(500).json({message:'Error fetching questions'});
    }
};

exports.addQuestion=async(req,res)=>{
    try{
        const {
            questionText,
            question: questionField,
            options,
            topicId,
            subtopicId,
            explanation,
            questionImage,
            optionImages,
            explanationImage,
            correctAnswer,
            difficultyLevel,
            questionType,
            status
        }=req.body;
        const question=new Question({
            question: questionField || questionText,
            options,
            topicId,
            subtopicId,
            explanation,
            questionImage,
            optionImages,
            explanationImage,
            correctAnswer,
            difficultyLevel,
            questionType,
            status: status || 'accepted',
            isActive: true,
            isVerified: true,
            createdAt: new Date()
        });
        await question.save();
        res.json({message:"Question add successfully"});
    }
    catch(err){
        res.status(500).json({message:"Error adding question"});
    }
}

exports.deleteQuestion=async(req,res)=>{
    try{
        const deleted=await Question.findByIdAndDelete(req.params.id);
        if(!deleted){
            return res.status(404).json({message:'Question not found'});
        }
        res.json({message:"Question deleted successfully"});
    }
    catch(err){
        res.status(500).json({
            message:"Error deleting question"
        });
    }
};

exports.updateQuestion=async(req,res)=>{
    try{
        const updated=await Question.findByIdAndUpdate(
            req.params.id,
            req.body,
            {new:true}
        );
        res.json(updated);

    }
    catch(err){
        res.status(500).json({
            message:"Error updating question"
        })
    }
}
