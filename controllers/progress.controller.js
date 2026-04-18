const Progress=require('../models/Progress');
const User=require('../models/User');
const mongoose=require('mongoose');
const { getNextLesson } = require('../utils/learningPath');

exports.updateProgress=async({userId, topicId=null, subtopicId=null, percentage})=>{
    const passed=percentage>=90;
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

    await Progress.findOneAndUpdate(
        filter,
        update,
        {upsert:true}
    );
    return passed;
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

    await Progress.findOneAndUpdate(
        filter,
        {
            topicId: nextLesson.topicId || null,
            subtopicId: nextLesson.subtopicId || null,
            isUnlocked: true
        },
        { upsert: true }
    );

    return nextLesson;
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

exports.getSubtopicStudentDetails = async (req, res) => {
  const { subtopicId } = req.params;

  try {
    if(!mongoose.Types.ObjectId.isValid(subtopicId)){
      return res.status(400).json({message:"Invalid subtopic id"});
    }

    const objectSubtopicId = new mongoose.Types.ObjectId(subtopicId);

    const data = await User.aggregate([
      {
        $match: {
          role: "student"
        }
      },
      {
        $lookup: {
          from: "progresses",
          let: { userId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$userId", "$$userId"] },
                    { $eq: ["$subtopicId", objectSubtopicId] }
                  ]
                }
              }
            },
            { $sort: { lastAttempted: -1 } },
            { $limit: 1 }
          ],
          as: "progress"
        }
      },
      {
        $lookup: {
          from: "attempts",
          let: { userId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$userId", "$$userId"] },
                    { $eq: ["$quizId", objectSubtopicId] }
                  ]
                }
              }
            },
            {
              $group: {
                _id: null,
                attemptCount: { $sum: 1 },
                bestAttemptScore: { $max: { $ifNull: ["$percentage", 0] } },
                lastSubmittedAt: { $max: "$submittedAt" }
              }
            }
          ],
          as: "attemptStats"
        }
      },
      {
        $addFields: {
          progressDoc: { $arrayElemAt: ["$progress", 0] },
          attemptStats: { $arrayElemAt: ["$attemptStats", 0] }
        }
      },
      {
        $addFields: {
          attemptCount: { $ifNull: ["$attemptStats.attemptCount", 0] },
          hasAttempted: {
            $gt: [{ $ifNull: ["$attemptStats.attemptCount", 0] }, 0]
          },
          bestScore: {
            $ifNull: [
              "$progressDoc.bestScore",
              { $ifNull: ["$attemptStats.bestAttemptScore", 0] }
            ]
          },
          isCleared: { $ifNull: ["$progressDoc.isCleared", false] },
          lastAttempted: {
            $ifNull: ["$progressDoc.lastAttempted", "$attemptStats.lastSubmittedAt"]
          }
        }
      },
      {
        $project: {
          _id: 0,
          userId: "$_id",
          name: { $ifNull: ["$name", "Unknown Student"] },
          email: { $ifNull: ["$email", "No email available"] },
          bestScore: { $ifNull: ["$bestScore", 0] },
          isCleared: 1,
          attemptCount: 1,
          hasAttempted: 1,
          lastAttempted: 1
        }
      },
      {
        $sort: {
          hasAttempted: -1,
          bestScore: -1,
          name: 1
        }
      }
    ]);

    res.json(data);

  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Error fetching student analytics" });
  }
};
