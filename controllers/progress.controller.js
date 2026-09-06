const Progress=require('../models/Progress');
const mongoose=require('mongoose');
const { getNextLesson } = require('../utils/learningPath');

exports.updateProgress=async({userId, topicId=null, subtopicId=null, percentage})=>{
    const passed=percentage>=80;
    const filter = subtopicId
        ? {userId, subtopicId}
        : {userId, topicId, subtopicId:null};
    const update = {
        $max:{bestScore:percentage},
        $set:{
            topicId: topicId || null,
            subtopicId: subtopicId || null,
            lastAttempted:new Date(),
            isUnlocked:true
        }
    };

    if(passed){
        update.$set.isCleared = true;
    }

    if(percentage === 100){
        update.$set.isMastered = true;
    }

    try {
        await Progress.findOneAndUpdate(
            filter,
            update,
            {upsert:true}
        );
        console.log("[PROGRESS] updateProgress successful for user:", userId);
        return passed;
    } catch (err) {
        console.error("[PROGRESS] updateProgress error:", err);
        throw err;
    }
};

exports.unlockNextLesson=async(userId,{currentTopicId=null,currentSubtopicId=null}={})=>{
    const nextLesson = await getNextLesson({
        userId,
        currentTopicId,
        currentSubtopicId
    });

    if(!nextLesson){
        return null;
    }

    const filter = nextLesson.subtopicId
        ? { userId, subtopicId: nextLesson.subtopicId }
        : { userId, topicId: nextLesson.topicId, subtopicId: null };

    try {
        await Progress.findOneAndUpdate(
            filter,
            {
                topicId: nextLesson.topicId || null,
                subtopicId: nextLesson.subtopicId || null,
                isUnlocked: true
            },
            { upsert: true }
        );
        console.log("[PROGRESS] unlockNextLesson successful for user:", userId, "Next:", nextLesson.key);
        return nextLesson;
    } catch (err) {
        console.error("[PROGRESS] unlockNextLesson error:", err);
        throw err;
    }
};

exports.getUserProgress=async(req,res)=>{
    const {userId}=req.params;
    try{
        if(!mongoose.Types.ObjectId.isValid(userId)){
            return res.status(400).json({message:"Invalid user id"});
        }

        const progress=await Progress.find({userId});
        res.json(progress);
    }
    catch(err){
        console.log(err);
        res.status(500).json({message:"Error fetching progress"});
    }
};

