const Question = require('../models/Question');
const Attempt = require('../models/Attempt');
const Progress = require('../models/Progress');
const mongoose = require('mongoose');
const cache = require('memory-cache');

const {
  getAnswerType,
  getCorrectOptionIndex,
  getCorrectOptionIndexes,
  getNumericalAnswer,
  isNumericalAnswerCorrect,
  normalizeQuestion,
  stripAnswers,
} = require('../utils/questionFormat');
const { getLearningPathForUser, getLessonKey } = require('../utils/learningPath');
const { updateProgress, unlockNextLesson } = require('./progress.controller');

const QUIZ_SIZE = 25;
const PRACTICE_SIZE = 100;

// Quiz questions are served without their answers; practice mode and the post-submit review include them.
const quizQuestion = (question) => stripAnswers(normalizeQuestion(question));

const STUDENT_VISIBLE_QUESTION = { status: { $nin: ['pending', 'rejected'] } };

function sampleQuizQuestions(match) {
    return Question.aggregate([
        { $match: { ...match, ...STUDENT_VISIBLE_QUESTION } },
        { $sample: { size: QUIZ_SIZE } }
    ]);
}

// Questions of a saved session, in the order they were first served.
async function questionsForSession(session) {
  const questions = await Question.find({ _id: { $in: session.questionOrder } }).lean();
  const byId = new Map(questions.map(q => [q._id.toString(), q]));
  return session.questionOrder.map(id => byId.get(id.toString())).filter(Boolean);
}

// Serves a quiz for a topic or subtopic: resumes the caller's open session when there is one, otherwise starts a
// new session from a random sample. `idField` is 'topicId' or 'subtopicId'.
async function serveQuiz(req, res, idField) {
  const id = req.params[idField];
  const { sessionId } = req.query;
  const label = idField === 'topicId' ? 'topic' : 'subtopic';

  try {
    const userId = req.userId || req.headers.userid;

    if (!userId) {
      return res.status(401).json({ message: "User not authenticated" });
    }

    if (sessionId) {
      const session = await Attempt.findById(sessionId).lean();

      if (!session) {
        return res.status(404).json({ message: "Session not found" });
      }

      if (session.userId.toString() !== userId.toString()) {
        return res.status(403).json({ message: "Unauthorized session" });
      }

      if (!Array.isArray(session.questionOrder)) {
        await Attempt.deleteOne({ _id: session._id });
        return res.status(400).json({ message: "Corrupted session. Please restart quiz." });
      }

      const ordered = await questionsForSession(session);
      return res.json({ sessionId, questions: ordered.map(quizQuestion) });
    }

    const existingSession = await Attempt.findOne({ userId, quizId: id, isSubmitted: false }).lean();

    if (existingSession) {
      if (!Array.isArray(existingSession.questionOrder) || existingSession.questionOrder.length === 0) {
        await Attempt.deleteOne({ _id: existingSession._id });
      } else {
        const ordered = await questionsForSession(existingSession);
        await Attempt.findByIdAndUpdate(existingSession._id, { startedAt: new Date() });

        return res.json({
          sessionId: existingSession._id,
          questions: ordered.map(quizQuestion)
        });
      }
    }

    const learningPath = await getLearningPathForUser(userId);
    const lessonKey = getLessonKey({ [idField]: id });
    const currentLesson = learningPath?.lessons?.find(l => l.key === lessonKey);

    if (currentLesson && !currentLesson.isUnlocked) {
      return res.status(403).json({ message: "Lesson is locked" });
    }

    const questions = await sampleQuizQuestions({ [idField]: new mongoose.Types.ObjectId(id) });

    if (!questions || questions.length === 0) {
      return res.status(404).json({ message: `No questions available for this ${label}` });
    }

    const session = await new Attempt({
      userId,
      quizId: id,
      questionOrder: questions.map(q => q._id),
      isSubmitted: false,
      startedAt: new Date()
    }).save();

    res.json({
      sessionId: session._id.toString(),
      questions: questions.map(quizQuestion)
    });
  } catch (err) {
    console.error(`GET QUIZ (${label}) ERROR:`, err);
    res.status(500).json({ message: "Error fetching questions" });
  }
}

exports.getQuiz = (req, res) => serveQuiz(req, res, 'topicId');

exports.getQuizBySubtopic = (req, res) => serveQuiz(req, res, 'subtopicId');

exports.getPracticeQuestions = async (req, res) => {
  const { topicId, subtopicId } = req.query;

  try {
    const idField = subtopicId ? 'subtopicId' : 'topicId';
    const id = subtopicId || topicId;

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "A valid topicId or subtopicId is required" });
    }

    const questions = await Question.aggregate([
      { $match: { [idField]: new mongoose.Types.ObjectId(id), ...STUDENT_VISIBLE_QUESTION } },
      { $sample: { size: PRACTICE_SIZE } }
    ]);

    if (questions.length === 0) {
      return res.status(404).json({ message: "No practice questions available" });
    }

    res.json({ questions: questions.map(q => normalizeQuestion(q)) });
  } catch (err) {
    console.error("GET PRACTICE ERROR:", err);
    res.status(500).json({ message: "Error fetching practice questions" });
  }
};

const MAX_TRIES_BEFORE_REVEAL = 3;

// Counts a tap on a single-choice option. On the third try the correct option is revealed, as the quiz has always
// worked, but the count and the answer now live on the server so the answer never reaches the phone early.
exports.recordTry = async (req, res) => {
  const { sessionId, questionId } = req.body;
  const userId = req.userId || req.headers.userid;

  try {
    if (!mongoose.Types.ObjectId.isValid(sessionId) || !mongoose.Types.ObjectId.isValid(questionId)) {
      return res.status(400).json({ message: "sessionId and questionId are required" });
    }

    const session = await Attempt.findOneAndUpdate(
      { _id: sessionId, userId, isSubmitted: false, questionOrder: new mongoose.Types.ObjectId(questionId) },
      { $inc: { [`tries.${questionId}`]: 1 } },
      { new: true, strict: false }
    ).lean();

    if (!session) {
      return res.status(404).json({ message: "Open quiz session not found" });
    }

    const attempts = session.tries?.[questionId] || 1;
    if (attempts < MAX_TRIES_BEFORE_REVEAL) {
      return res.json({ attempts });
    }

    const question = await Question.findById(questionId).lean();
    const revealedOptionIndex = question && getAnswerType(question) === 'single' ? getCorrectOptionIndex(question) : -1;

    res.json({ attempts, revealedOptionIndex: revealedOptionIndex >= 0 ? revealedOptionIndex : undefined });
  } catch (err) {
    console.error("RECORD TRY ERROR:", err);
    res.status(500).json({ message: "Error recording attempt" });
  }
};

exports.submitQuiz = async (req, res) => {
  let {
    sessionId,
    answers = [],
    subtopicId,
    topicId,
    isTimedOut = false
  } = req.body;

  if (subtopicId === "undefined" || subtopicId === "null" || !subtopicId) subtopicId = null;
  if (topicId === "undefined" || topicId === "null" || !topicId) topicId = null;

  const userId = req.userId || req.headers.userid;

  try {
    if (!sessionId) {
        console.error("[SUBMIT] Missing sessionId");
        return res.status(400).json({ message: "Session ID is required" });
    }
    const session = await Attempt.findById(sessionId);

    if (!session) {
      console.error("[SUBMIT] Session not found for ID:", sessionId);
      return res.status(404).json({ message: "Session not found" });
    }


    if (session.userId.toString() !== userId.toString()) {
      console.error("[SUBMIT] Unauthorized session. Session User:", session.userId, "Request User:", userId);
      return res.status(403).json({ message: "Unauthorized session" });
    }

    if (session.isSubmitted) {
      return res.status(400).json({ message: "Quiz already submitted" });
    }

    // Progress is credited to the lesson the session was started for, never to one the client names.
    const lessonId = subtopicId || topicId;
    if (lessonId && String(lessonId) !== String(session.quizId)) {
      return res.status(400).json({ message: "Session does not belong to this lesson" });
    }

    const order = session.questionOrder;

    if (!Array.isArray(order) || order.length === 0) {
      console.error("[SUBMIT] CRITICAL: questionOrder is empty or missing in DB for session", session._id);
      return res.status(400).json({
        message: "Session corrupted. Please restart quiz."
      });
    }

    const validQuestionIds = order.filter(id => mongoose.Types.ObjectId.isValid(id));
    if (validQuestionIds.length !== order.length) {
        console.error("[SUBMIT] Some question IDs in order are invalid:", order);
    }

    const questions = await Question.find({
      _id: { $in: validQuestionIds }
    }).lean();

    const questionMap = {};
    questions.forEach(q => {
      questionMap[q._id.toString()] = q;
    });

    const answerMap = {};
    answers.forEach(a => {
      if (
        a?.questionId &&
        (typeof a.selectedOptionIndex === "number" ||
          Array.isArray(a.selectedOptionIndexes) ||
          typeof a.selectedNumericalAnswer === "string")
      ) {
        answerMap[a.questionId] = a;
      }
    });

    let correct = 0;
    const evaluatedAnswers = [];
    const reviewQuestions = [];


    for (const qId of order) {
      let rawQuestion = questionMap[qId.toString()];

      if (!rawQuestion && typeof qId === 'object') {
          rawQuestion = questions.find(q => q._id.toString() === qId.toString());
      }

      if (!rawQuestion) {
        console.warn(`[SUBMIT] Question ${qId} not found in database for session ${sessionId}. Skipping this question.`);
        continue;
      }

      const ans = answerMap[qId.toString()];
      const q = normalizeQuestion(rawQuestion);
      reviewQuestions.push(q);
      const answerType = getAnswerType(rawQuestion);

      let isCorrect = false;
      let selectedIndex = null;
      let selectedIndexes = null;
      let selectedNumericalAnswer = null;

      if (answerType === "multiple") {
        if (ans && Array.isArray(ans.selectedOptionIndexes)) {
          selectedIndexes = ans.selectedOptionIndexes.filter(
            (idx) => typeof idx === "number" && idx >= 0 && idx < (q.options?.length || 0)
          );
        }

        const correctIndexes = getCorrectOptionIndexes(rawQuestion);
        if (selectedIndexes && correctIndexes.length > 0) {
          const selectedSet = new Set(selectedIndexes);
          const correctSet = new Set(correctIndexes);
          isCorrect =
            selectedSet.size === correctSet.size &&
            [...selectedSet].every((idx) => correctSet.has(idx));
        }
      } else if (answerType === "numerical") {
        if (ans && typeof ans.selectedNumericalAnswer === "string") {
          selectedNumericalAnswer = ans.selectedNumericalAnswer;
        }

        isCorrect = isNumericalAnswerCorrect(selectedNumericalAnswer, getNumericalAnswer(rawQuestion));
      } else {
        if (ans && typeof ans.selectedOptionIndex === "number") {
          selectedIndex = ans.selectedOptionIndex;

          if (
            selectedIndex < 0 ||
            selectedIndex >= (q.options?.length || 0)
          ) {
            selectedIndex = null;
          }
        }

        const selectedOption =
          selectedIndex !== null ? q.options[selectedIndex] : null;

        const correctOptionIndex = getCorrectOptionIndex(rawQuestion);

        if (selectedOption && typeof selectedOption === "object") {
          isCorrect = Boolean(selectedOption.isCorrect);
        } else if (
          correctOptionIndex !== -1 &&
          selectedIndex !== null
        ) {
          isCorrect = selectedIndex === correctOptionIndex;
        } else if (typeof selectedOption === "string") {
          isCorrect = selectedOption === q.correctAnswer;
        }
      }

      if (isCorrect) correct++;

      evaluatedAnswers.push({
        questionId: qId,
        selectedOptionIndex: selectedIndex,
        selectedOptionIndexes: selectedIndexes,
        selectedNumericalAnswer,
        isCorrect
      });
    }

    const totalQuestions = evaluatedAnswers.length;
    const percentage = totalQuestions
      ? (correct / totalQuestions) * 100
      : 0;
    const passed = percentage >= 80;

    const userObjectId = mongoose.Types.ObjectId.isValid(userId)
      ? new mongoose.Types.ObjectId(userId)
      : userId;
    const attemptCount = await Attempt.countDocuments({
      userId: userObjectId,
      quizId: session.quizId,
      isSubmitted: true
    });

    const MAX_QUIZ_ATTEMPTS = 3;
    const attemptsExhausted = attemptCount + 1 >= MAX_QUIZ_ATTEMPTS;

    // The student's best score on this lesson before this attempt, so the result screen can say "new best" or show
    // the change. Read before updateProgress / the $max update below overwrite it.
    let previousBest = null;
    if (subtopicId || topicId) {
      const previous = await Progress.findOne(
        subtopicId ? { userId, subtopicId } : { userId, topicId, subtopicId: null }
      ).select('bestScore').lean();
      previousBest = typeof previous?.bestScore === 'number' ? previous.bestScore : null;
    }

    if (subtopicId || topicId) {
      const progressPassed = await updateProgress({
        userId,
        topicId: topicId || null,
        subtopicId: subtopicId || null,
        percentage
      });

      if (progressPassed) {
        await unlockNextLesson(userId, {
          currentTopicId: topicId,
          currentSubtopicId: subtopicId
        });
      }

      if (attemptCount >= 2) {

        await Progress.findOneAndUpdate(
          subtopicId
            ? { userId, subtopicId }
            : { userId, topicId, subtopicId: null },
          {
            $set: {
              isCleared: true,
              topicId: topicId || null,
              subtopicId: subtopicId || null
            }
          },
          { upsert: true }
        );

        await unlockNextLesson(userId, {
          currentTopicId: topicId,
          currentSubtopicId: subtopicId
        });
      }

      await Progress.findOneAndUpdate(
        subtopicId
          ? { userId, subtopicId }
          : { userId, topicId, subtopicId: null },
        {
          $max: { bestScore: percentage },
          $set: {
            topicId: topicId || null,
            subtopicId: subtopicId || null,
            lastAttempted: new Date(),
            ...(percentage === 100 && { isMastered: true }),
            ...(percentage >= 80 && { isCleared: true })
          }
        },
        { upsert: true }
      );
    }

    session.score = correct;
    session.totalQuestions = totalQuestions;
    session.percentage = percentage;
    session.isExplanationUnlocked = passed || attemptsExhausted;
    session.isPassed = passed;
    session.isSubmitted = true;
    session.isTimedOut = Boolean(isTimedOut);
    session.responses = evaluatedAnswers;
    session.submittedAt = new Date();

    if (typeof session.save !== 'function') {
        console.error("[SUBMIT] CRITICAL: session.save is not a function. session type:", typeof session);
        return res.status(500).json({ message: "Internal server error: session document corrupted" });
    }

    try {
        await session.save();
    } catch (saveErr) {
        console.error("[SUBMIT] Error saving session:", saveErr);
        return res.status(500).json({ message: "Error saving quiz results: " + saveErr.message });
    }

    cache.del(`dashboard_${userId}`);

    res.json({
      score: correct,
      percentage,
      passed,
      attemptNumber: attemptCount + 1,
      maxAttempts: MAX_QUIZ_ATTEMPTS,
      attemptsExhausted,
      previousBest,
      reviewUnlocked: session.isExplanationUnlocked,
      // Answers and explanations are only sent once the student is allowed to see them.
      review: session.isExplanationUnlocked ? reviewQuestions : undefined,
      message: passed ? "Unlocked" : "Retry"
    });

  } catch (err) {
    console.error("SUBMIT QUIZ ERROR:", err);
    res.status(500).json({
      message: "Internal server error during submission. " + (err.message || "")
    });
  }
};
