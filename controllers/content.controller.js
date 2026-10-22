const mongoose=require('mongoose');
const Unit=require('../models/Unit');
const Topic=require('../models/Topic');
const Subtopic=require('../models/Subtopic');
const {
  getLearningPathForUser,
  getNextLesson: resolveNextLesson,
} = require('../utils/learningPath');
const { getQuestionCounts, getPracticedCounts } = require('../utils/practiceCounts');
const { addPracticeInfo } = require('../utils/practiceSet');

exports.getUnits=async(req,res)=>{
    try{
        const { examId } = req.query;
        const filter = { isActive:{$ne:false} };
        if (examId && mongoose.Types.ObjectId.isValid(examId)) {
            filter.examId = examId;
        }

        const units=await Unit.find(filter).sort({order:1});
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
    const userId = req.userId;
    const learningPath = await getLearningPathForUser(userId, { examId: req.query.examId });

    // Question counts and practice progress are extras: the path still loads if they cannot be read.
    let units = learningPath.units;
    try {
      const [counts, practiced] = await Promise.all([getQuestionCounts(), getPracticedCounts(userId)]);
      units = addPracticeInfo(units, counts, practiced);
    } catch (err) {
      console.error('Practice info error:', err.message);
    }

    res.json({
      units,
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
    const userId = req.userId;

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
