const Question=require('../models/Question');
const Attempt=require('../models/Attempt');
const Progress=require('../models/Progress');
const mongoose=require('mongoose');
const { getCorrectOptionIndex, normalizeQuestion } = require('../utils/questionFormat');
const { getLearningPathForUser, getLessonKey } = require('../utils/learningPath');

const {updateProgress,unlockNextLesson}=require('./progress.controller');


exports.getQuiz=async(req,res)=>{
    const {topicId}= req.params;
    try{
        const userId=req.userId||req.headers.userid;
        const learningPath = await getLearningPathForUser(userId);
        const lessonKey = getLessonKey({ topicId });
        const currentLesson = learningPath.lessons.find((lesson) => lesson.key === lessonKey);

        if(currentLesson && !currentLesson.isUnlocked){
            return res.status(403).json({message:"Lesson is locked"});
        }

        const questions=await Question.aggregate([
            {$match:{topicId:new mongoose.Types.ObjectId(topicId)}},
            {$sample:{size:25}}
        ]);
        res.json(questions.map((question) => normalizeQuestion(question)));
    }
    catch(err){
        console.log(err);
        res.status(500).json({message:"Error fetching questions"});
    }
};

exports.getQuizBySubtopic=async(req,res)=>{
    console.log("hii");
    const {subtopicId}=req.params;
    console.log(subtopicId);
    try{
        const userId=req.userId||req.headers.userid;
        const learningPath = await getLearningPathForUser(userId);
        const lessonKey = getLessonKey({ subtopicId });
        const currentLesson = learningPath.lessons.find((lesson) => lesson.key === lessonKey);

        if(currentLesson && !currentLesson.isUnlocked){
            return res.status(403).json({message:"Lesson is locked"});
        }

        const questions=await Question.aggregate([
            {
                $match:{
                    subtopicId:new mongoose.Types.ObjectId(subtopicId)
                }
            },{$sample:{size:25}}
        ]);
        res.json(questions.map((question) => normalizeQuestion(question)));
    }
    catch(err){
        console.log(err);
        res.status(500).json({message:"Error fetching question is error"});
    }
};

exports.submitQuiz=async(req,res)=>{
    const {answers=[],subtopicId,topicId,isTimedOut=false}=req.body;
    const userId=req.userId||req.headers.userid;

    try{
        let correct=0;
        for(const ans of answers){
            const rawQuestion=await Question.findById(ans.questionId).lean();
            if(!rawQuestion){
                return res.status(404).json({message:"Question not found"});
            }

            const q = normalizeQuestion(rawQuestion);
            const selectedOption=q.options?.[ans.selectedOptionIndex];
            const correctOptionIndex = getCorrectOptionIndex(rawQuestion);
            let isCorrect=false;

            if(selectedOption && typeof selectedOption === 'object'){
                isCorrect=Boolean(selectedOption.isCorrect);
            }
            else if(correctOptionIndex !== -1){
                isCorrect=ans.selectedOptionIndex===correctOptionIndex;
            }
            else{
                isCorrect=typeof selectedOption === 'string' && selectedOption===q.correctAnswer;
            }

            if(isCorrect){
                correct++;
            }
            ans.isCorrect=isCorrect;
        }

        const percentage=answers.length ? (correct/answers.length)*100 : 0;
        const passed=percentage>=90;

        if(subtopicId || topicId){
            const progressPassed=await updateProgress({
                userId,
                topicId,
                subtopicId,
                percentage
            });
            if(progressPassed){
                await unlockNextLesson(userId,{
                    currentTopicId: topicId,
                    currentSubtopicId: subtopicId
                });
            }

            const progressFilter = subtopicId
                ? { userId, subtopicId }
                : { userId, topicId, subtopicId: null };
            const progressUpdate = {
                $max: { bestScore: percentage },
                $set: {
                    topicId: topicId || null,
                    subtopicId: subtopicId || null,
                    lastAttempted: new Date()
                }
            };

            if(progressPassed){
                progressUpdate.$set.isCleared = true;
            }

            if(percentage === 100){
                progressUpdate.$set.isMastered = true;
            }

            await Progress.findOneAndUpdate(
                progressFilter,
                progressUpdate,
                { upsert: true }
            );
        }

        await Attempt.create({
            userId,
            quizId:subtopicId||topicId,
            questionOrder:answers.map(a=>a.questionId),
            score: correct,
            totalQuestions: answers.length,
            percentage,
            isExplanationUnlocked: percentage >= 85,
            isPassed: passed,
            isSubmitted: true,
            isTimedOut: Boolean(isTimedOut),
            responses: answers,
            startedAt: new Date(),
            submittedAt: new Date()
        });

        res.json({
            score:correct,
            percentage,
            passed,
            message:passed?"Unlocked":"Retry"
        });
    }
    catch(err){
        console.log(err);
        res.status(500).json({message:"Error submitting quiz"});
    }
}
