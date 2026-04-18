const mongoose=require('mongoose');
const Unit=require('../models/Unit');
const Topic=require('../models/Topic');
const Subtopic=require('../models/Subtopic');
const {
  getLearningPathForUser,
  getNextLesson: resolveNextLesson,
} = require('../utils/learningPath');

exports.getUnits=async(req,res)=>{
    try{
        const units=await Unit.find({
            isActive:{$ne:false}
        }).sort({order:1});
        res.json(units);
    }
    catch(err){
        console.log(err);
        res.status(500).json({message:"Error fetching units"});
    }
};

exports.getTopics=async(req,res)=>{
    try{
        const {unitId}=req.params;
        console.log(req.params);

        if(!mongoose.Types.ObjectId.isValid(unitId)){
            return res.status(400).json({message:"Invalid unit"});
        }

        const topics=await Topic.find({
            unitId,
            isActive:{$ne:false}
        }).sort({order:1});

        res.json(topics);
    }
    catch(err){
        console.log(err);
        res.status(500).json({message:"Error fetching topics"});
    }
};

exports.getSubtopics = async (req, res) => {
  try{
    const {topicId}=req.params;

    if(!mongoose.Types.ObjectId.isValid(topicId)){
      return res.status(400).json({message:"Invalid topic id"});
    }

    const subtopics=await Subtopic.find({
      topicId,
      isActive:{$ne:false}
    }).sort({order:1});

    res.json(subtopics);
  }
  catch(err){
    console.log(err);
    res.status(500).json({message:"Error fetching subtopics"});
  }
};

exports.getLearningPath = async (req, res) => {
  try {
    const userId = req.headers.userid || req.query.userId;
    const learningPath = await getLearningPathForUser(userId);

    res.json({
      units: learningPath.units,
      lessons: learningPath.lessons,
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: 'Error fetching learning path' });
  }
};

exports.getNextLesson = async (req, res) => {
  try {
    const { topicId, subtopicId } = req.query;
    const userId = req.headers.userid || req.query.userId;

    if (!topicId && !subtopicId) {
      return res.status(400).json({ message: 'Current lesson is required' });
    }

    const nextLesson = await resolveNextLesson({
      currentTopicId: topicId,
      currentSubtopicId: subtopicId,
      userId,
    });

    res.json(nextLesson || null);
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: 'Error fetching next lesson' });
  }
};
