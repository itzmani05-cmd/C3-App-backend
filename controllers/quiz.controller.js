const Question = require('../models/Question');
const Attempt = require('../models/Attempt');
const Progress = require('../models/Progress');
const mongoose = require('mongoose');

const { getCorrectOptionIndex, normalizeQuestion } = require('../utils/questionFormat');
const { getLearningPathForUser, getLessonKey } = require('../utils/learningPath');
const { updateProgress, unlockNextLesson } = require('./progress.controller');

function shuffleArray(array) {
    return array.sort(() => Math.random() - 0.5);
}

exports.getQuiz = async (req, res) => {
  const { topicId } = req.params;
  const { sessionId } = req.query;

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

      // ❗ FIX: Safe handling
      if (!Array.isArray(session.questionOrder)) {
        await Attempt.deleteOne({ _id: session._id });
        return res.status(400).json({
          message: "Corrupted session. Please restart quiz."
        });
      }

      const questions = await Question.find({
        _id: { $in: session.questionOrder }
      }).lean();

      const questionMap = {};
      questions.forEach(q => {
        questionMap[q._id.toString()] = q;
      });

      const orderedQuestions = session.questionOrder
        .map(id => questionMap[id.toString()])
        .filter(Boolean);

      return res.json({
        sessionId,
        questions: orderedQuestions.map(q => normalizeQuestion(q))
      });
    }

    const existingSession = await Attempt.findOne({
      userId,
      quizId: topicId,
      isSubmitted: false
    }).lean();

    if (existingSession) {
      // ❗ FIX: Remove corrupted sessions
      if (!Array.isArray(existingSession.questionOrder)) {
        await Attempt.deleteOne({ _id: existingSession._id });
      } else {
        const questions = await Question.find({
          _id: { $in: existingSession.questionOrder }
        }).lean();

        const questionMap = {};
        questions.forEach(q => {
          questionMap[q._id.toString()] = q;
        });

        const orderedQuestions = existingSession.questionOrder
          .map(id => questionMap[id.toString()])
          .filter(Boolean);

        // Reset startedAt on resume
        await Attempt.findByIdAndUpdate(existingSession._id, { startedAt: new Date() });

        return res.json({
          sessionId: existingSession._id,
          questions: orderedQuestions.map(q => normalizeQuestion(q))
        });
      }
    }

    // =========================
    // 🔒 CHECK LESSON UNLOCK
    // =========================
    const learningPath = await getLearningPathForUser(userId);
    const lessonKey = getLessonKey({ topicId });
    const currentLesson = learningPath?.lessons?.find(l => l.key === lessonKey);

    if (currentLesson && !currentLesson.isUnlocked) {
      return res.status(403).json({ message: "Lesson is locked" });
    }

    // =========================
    // 📥 FETCH QUESTIONS
    // =========================
    const questions = await Question.find({
      topicId: new mongoose.Types.ObjectId(topicId)
    })
      .limit(50)
      .lean();

    // ❗ FIX: No questions check
    if (!questions || questions.length === 0) {
      return res.status(404).json({
        message: "No questions available for this topic"
      });
    }

    // =========================
    // 🔀 SHUFFLE + CREATE SESSION
    // =========================
    const shuffled = shuffleArray(questions).slice(0, 25);

    console.log("[GET QUIZ] Creating session object...");
    const session = new Attempt({
      userId,
      quizId: topicId,
      questionOrder: shuffled.map(q => q._id),
      isSubmitted: false,
      startedAt: new Date()
    });

    console.log("[GET QUIZ] Session object before save:", {
        id: session._id,
        orderLength: session.questionOrder?.length,
        orderData: session.questionOrder
    });

    await session.save();

    console.log("[GET QUIZ] Session saved. Final order in memory:", session.questionOrder?.length);

    res.json({
      sessionId: session._id.toString(),
      questions: shuffled.map(q => normalizeQuestion(q))
    });

  } catch (err) {
    console.error("GET QUIZ ERROR:", err);
    res.status(500).json({
      message: err.message || "Error fetching questions"
    });
  }
};

exports.getQuizBySubtopic = async (req, res) => {
    const { subtopicId } = req.params;
    const { sessionId } = req.query;

    try {
        const userId = req.userId || req.headers.userid;

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
                return res.status(400).json({
                    message: "Corrupted session. Please restart quiz."
                });
            }

            const questions = await Question.find({
                _id: { $in: session.questionOrder }
            }).lean();

            const questionMap = {};
            questions.forEach(q => {
                questionMap[q._id.toString()] = q;
            });

            const orderedQuestions = session.questionOrder.map(id =>
                questionMap[id.toString()]
            ).filter(Boolean);

            return res.json({
                sessionId,
                questions: orderedQuestions.map(q => normalizeQuestion(q))
            });
        }

        const existingSession = await Attempt.findOne({
            userId,
            quizId: subtopicId,
            isSubmitted: false
        }).lean();

        if (existingSession) {
            if (!Array.isArray(existingSession.questionOrder)) {
                await Attempt.deleteOne({ _id: existingSession._id });
            } else {
                const questions = await Question.find({
                    _id: { $in: existingSession.questionOrder }
                }).lean();

                const questionMap = {};
                questions.forEach(q => {
                    questionMap[q._id.toString()] = q;
                });

                const orderedQuestions = existingSession.questionOrder.map(id =>
                    questionMap[id.toString()]
                ).filter(Boolean);

                // Reset startedAt on resume
                await Attempt.findByIdAndUpdate(existingSession._id, { startedAt: new Date() });

                return res.json({
                    sessionId: existingSession._id,
                    questions: orderedQuestions.map(q => normalizeQuestion(q))
                });
            }
        }

        const learningPath = await getLearningPathForUser(userId);
        const lessonKey = getLessonKey({ subtopicId });
        const currentLesson = learningPath.lessons.find(l => l.key === lessonKey);

        if (currentLesson && !currentLesson.isUnlocked) {
            return res.status(403).json({ message: "Lesson is locked" });
        }

        const questions = await Question.find({
            subtopicId: new mongoose.Types.ObjectId(subtopicId)
        })
        .limit(50)
        .lean();

        const shuffled = shuffleArray(questions).slice(0, 25);

        console.log("[GET QUIZ SUBTOPIC] Creating session object...");
        const session = new Attempt({
            userId,
            quizId: subtopicId,
            questionOrder: shuffled.map(q => q._id),
            isSubmitted: false,
            startedAt: new Date()
        });

        console.log("[GET QUIZ SUBTOPIC] Session object before save:", {
            id: session._id,
            orderLength: session.questionOrder?.length
        });

        await session.save();

        console.log("[GET QUIZ SUBTOPIC] Session saved successfully");

        res.json({
            sessionId: session._id.toString(),
            questions: shuffled.map(q => normalizeQuestion(q))
        });

    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Error fetching questions" });
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

  // Sanitize IDs
  if (subtopicId === "undefined" || subtopicId === "null" || !subtopicId) subtopicId = null;
  if (topicId === "undefined" || topicId === "null" || !topicId) topicId = null;

  const userId = req.userId || req.headers.userid;
  console.log("[SUBMIT] Sanitized IDs:", { sessionId, subtopicId, topicId, userId });

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

    console.log("[SUBMIT] Found session:", { sessionId: session._id, sessionUserId: session.userId, sessionIsSubmitted: session.isSubmitted });

    if (session.userId.toString() !== userId.toString()) {
      console.error("[SUBMIT] Unauthorized session. Session User:", session.userId, "Request User:", userId);
      return res.status(403).json({ message: "Unauthorized session" });
    }

    if (session.isSubmitted) {
      return res.status(400).json({ message: "Quiz already submitted" });
    }

    const QUIZ_DURATION = 3600 * 24; // 24 hours
    const elapsed =
      (Date.now() - new Date(session.startedAt).getTime()) / 1000;

    if (!isTimedOut && elapsed > QUIZ_DURATION) {
      console.log("[SUBMIT] Quiz submitted after 24 hours. Session:", session._id);
    }
    const order = session.questionOrder;
    console.log("[SUBMIT] Session retrieved from DB:", {
        id: session._id,
        hasOrder: !!order,
        isArray: Array.isArray(order),
        length: order?.length
    });

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
    console.log("[SUBMIT] Fetched questions from DB count:", questions.length);

    const questionMap = {};
    questions.forEach(q => {
      questionMap[q._id.toString()] = q;
    });

    const answerMap = {};
    answers.forEach(a => {
      if (a?.questionId && typeof a.selectedOptionIndex === "number") {
        answerMap[a.questionId] = a;
      }
    });

    let correct = 0;
    const evaluatedAnswers = [];

    console.log("[SUBMIT] Starting answer evaluation for questions:", order.length);

    for (const qId of order) {
      let rawQuestion = questionMap[qId.toString()];
      
      // FALLBACK: Try finding by value if it's an ObjectId object
      if (!rawQuestion && typeof qId === 'object') {
          rawQuestion = questions.find(q => q._id.toString() === qId.toString());
      }

      if (!rawQuestion) {
        console.warn(`[SUBMIT] Question ${qId} not found in database for session ${sessionId}. Skipping this question.`);
        continue;
      }

      const ans = answerMap[qId.toString()];
      const q = normalizeQuestion(rawQuestion);

      let isCorrect = false;
      let selectedIndex = null;

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

      if (isCorrect) correct++;

      evaluatedAnswers.push({
        questionId: qId,
        selectedOptionIndex: selectedIndex,
        isCorrect
      });
    }

    const totalQuestions = evaluatedAnswers.length;
    const percentage = totalQuestions
      ? (correct / totalQuestions) * 100
      : 0;
    const passed = percentage >= 80;

    // Count previously submitted attempts on this exact quiz session's quizId (current attempt not
    // yet saved), so >= 2 previous + 1 current = 3 total attempts. Computed once here (rather than
    // only inside the topicId/subtopicId branch below) so it's also available to gate the answer
    // review further down, regardless of whether progress tracking applies to this quiz.
    const userObjectId = mongoose.Types.ObjectId.isValid(userId)
      ? new mongoose.Types.ObjectId(userId)
      : userId;
    const attemptCount = await Attempt.countDocuments({
      userId: userObjectId,
      quizId: session.quizId,
      isSubmitted: true
    });
    console.log("[SUBMIT] Previous submitted attempts for quiz", session.quizId, ":", attemptCount, "(current attempt not yet saved)");

    const MAX_QUIZ_ATTEMPTS = 3;
    const attemptsExhausted = attemptCount + 1 >= MAX_QUIZ_ATTEMPTS;

    if (subtopicId || topicId) {
      const progressPassed = await updateProgress({
        userId,
        topicId: topicId || null,
        subtopicId: subtopicId || null,
        percentage
      });
      console.log("[SUBMIT] updateProgress result:", progressPassed);

      if (progressPassed) {
        await unlockNextLesson(userId, {
          currentTopicId: topicId,
          currentSubtopicId: subtopicId
        });
      }

      // ========================================
      // 🔓 AUTO-UNLOCK AFTER 3 ATTEMPTS (regardless of score)
      // ========================================
      if (attemptCount >= 2) {
        console.log("[SUBMIT] 3rd+ attempt reached (2 previous + current). Auto-unlocking next lesson.");

        // Mark current lesson as cleared so learning path recognizes it
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
    // Answer review unlocks on passing OR once the student has used all their attempts — otherwise a
    // student who never passes could never see the correct answers/explanations.
    session.isExplanationUnlocked = passed || attemptsExhausted;
    session.isPassed = passed;
    session.isSubmitted = true;
    session.isTimedOut = Boolean(isTimedOut);
    session.responses = evaluatedAnswers;
    session.submittedAt = new Date();

    console.log("[SUBMIT] Saving session data...");
    if (typeof session.save !== 'function') {
        console.error("[SUBMIT] CRITICAL: session.save is not a function. session type:", typeof session);
        return res.status(500).json({ message: "Internal server error: session document corrupted" });
    }

    try {
        await session.save();
        console.log("[SUBMIT] Session saved successfully");
    } catch (saveErr) {
        console.error("[SUBMIT] Error saving session:", saveErr);
        return res.status(500).json({ message: "Error saving quiz results: " + saveErr.message });
    }
    
    res.json({
      score: correct,
      percentage,
      passed,
      attemptNumber: attemptCount + 1,
      maxAttempts: MAX_QUIZ_ATTEMPTS,
      attemptsExhausted,
      reviewUnlocked: session.isExplanationUnlocked,
      message: passed ? "Unlocked" : "Retry"
    });

  } catch (err) {
    console.error("SUBMIT QUIZ ERROR:", err);
    res.status(500).json({
      message: "Internal server error during submission. " + (err.message || "")
    });
  }
};