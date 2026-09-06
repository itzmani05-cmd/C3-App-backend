const mongoose = require('mongoose');
const cache = require('memory-cache');
const User = require('../models/User');
require('../models/Exam'); // registers the 'Exam' model so User.populate('examIds') below can resolve it
const Attempt = require('../models/Attempt');
const Progress = require('../models/Progress');
const Subtopic = require('../models/Subtopic');
const Topic = require('../models/Topic');
const Unit = require('../models/Unit');

function getRequestUserId(req) {
  return req.userId || req.headers.userid;
}

async function buildLookup({ subtopicIds = [], topicIds = [] }) {
  const uniqueSubtopicIds = [
    ...new Set(
      subtopicIds
        .filter(Boolean)
        .map((id) => String(id))
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
    ),
  ];

  const subtopics = uniqueSubtopicIds.length
    ? await Subtopic.find({ _id: { $in: uniqueSubtopicIds } }).lean()
    : [];

  const derivedTopicIds = subtopics
    .map((item) => item.topicId)
    .filter(Boolean)
    .map((id) => String(id));

  const uniqueTopicIds = [
    ...new Set(
      [...topicIds, ...derivedTopicIds]
        .filter(Boolean)
        .map((id) => String(id))
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
    ),
  ];

  const topics = uniqueTopicIds.length
    ? await Topic.find({ _id: { $in: uniqueTopicIds } }).lean()
    : [];

  const uniqueUnitIds = [
    ...new Set(
      topics
        .map((item) => item.unitId)
        .filter(Boolean)
        .map((id) => String(id))
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
    ),
  ];

  const units = uniqueUnitIds.length
    ? await Unit.find({ _id: { $in: uniqueUnitIds } }).lean()
    : [];

  return {
    subtopicMap: new Map(subtopics.map((item) => [String(item._id), item])),
    topicMap: new Map(topics.map((item) => [String(item._id), item])),
    unitMap: new Map(units.map((item) => [String(item._id), item])),
  };
}

function describeLearningItem(id, lookup) {
  if (!id) {
    return {
      title: 'Learning Item',
      topicName: null,
      unitName: null,
      subtitle: 'No content details available',
    };
  }

  const key = String(id);
  const subtopic = lookup.subtopicMap.get(key);
  if (subtopic) {
    const topic = lookup.topicMap.get(String(subtopic.topicId));
    const unit = topic ? lookup.unitMap.get(String(topic.unitId)) : null;

    return {
      title: subtopic.name || 'Subtopic',
      topicName: topic?.name || null,
      unitName: unit?.name || null,
      subtitle: [unit?.name, topic?.name].filter(Boolean).join(' • ') || 'Subtopic',
    };
  }

  const topic = lookup.topicMap.get(key);
  if (topic) {
    const unit = lookup.unitMap.get(String(topic.unitId));
    return {
      title: topic.name || 'Topic',
      topicName: topic.name || null,
      unitName: unit?.name || null,
      subtitle: unit?.name || 'Topic',
    };
  }

  return {
    title: 'Learning Item',
    topicName: null,
    unitName: null,
    subtitle: 'No content details available',
  };
}

exports.savePushToken = async (req, res) => {
  try {
    const userId = getRequestUserId(req);
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: 'Invalid user id' });
    }

    const { token } = req.body;
    if (typeof token !== 'string' || !token.trim()) {
      return res.status(400).json({ message: 'A push token is required' });
    }

    await User.findByIdAndUpdate(userId, { expoPushToken: token.trim() });
    res.json({ message: 'Push token saved' });
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: 'Error saving push token' });
  }
};

exports.getProfile = async (req, res) => {
  try {
    const userId = getRequestUserId(req);
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: 'Invalid user id' });
    }

    const user = await User.findById(userId)
      .select('name email role createdAt')
      .lean();

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json(user);
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: 'Error fetching profile' });
  }
};

exports.getMyExams = async (req, res) => {
  try {
    const userId = getRequestUserId(req);
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: 'Invalid user id' });
    }

    const user = await User.findById(userId)
      .select('examIds')
      .populate('examIds', 'name')
      .lean();

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const exams = (user.examIds || [])
      .filter(Boolean)
      .map((exam) => ({ _id: exam._id, name: exam.name }));

    res.json({ exams });
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: 'Error fetching exams' });
  }
};

exports.getDashboard = async (req, res) => {
  try {
    const userId = getRequestUserId(req);
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: 'Invalid user id' });
    }

    const cacheKey = `dashboard_${userId}`;
    const cachedData = cache.get(cacheKey);
    if (cachedData) {
      return res.json(cachedData);
    }

    const objectUserId = new mongoose.Types.ObjectId(userId);

    const [user, progressDocs, recentAttempts, attemptStats] = await Promise.all([
      User.findById(userId).select('name email role createdAt').lean(),
      Progress.find({ userId }).sort({ lastAttempted: -1 }).lean(),
      Attempt.find({ userId }).sort({ submittedAt: -1 }).limit(8).lean(),
      Attempt.aggregate([
        { $match: { userId: objectUserId } },
        {
          $group: {
            _id: null,
            totalAttempts: { $sum: 1 },
            averageScore: { $avg: '$percentage' },
            bestScore: { $max: '$percentage' },
            timedOutAttempts: {
              $sum: {
                $cond: [{ $eq: ['$isTimedOut', true] }, 1, 0],
              },
            },
          },
        },
      ]),
    ]);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const lookup = await buildLookup({
      subtopicIds: [
        ...progressDocs.map((item) => item.subtopicId),
        ...recentAttempts.map((item) => item.quizId),
      ],
      topicIds: [
        ...recentAttempts.map((item) => item.quizId),
        ...progressDocs.map((item) => item.topicId),
      ],
    });

    const stats = attemptStats[0] || {};

    const continueLearning = progressDocs.slice(0, 5).map((item) => {
      const learningItemId = item.subtopicId || item.topicId;
      const details = describeLearningItem(learningItemId, lookup);
      return {
        id: String(item._id),
        subtopicId: item.subtopicId ? String(item.subtopicId) : null,
        topicId: item.topicId ? String(item.topicId) : null,
        title: details.title,
        subtitle: details.subtitle,
        topicName: details.topicName,
        unitName: details.unitName,
        bestScore: item.bestScore || 0,
        isUnlocked: Boolean(item.isUnlocked),
        isCleared: Boolean(item.isCleared),
        isMastered: Boolean(item.isMastered),
        lastAttempted: item.lastAttempted,
      };
    });

    const recentActivity = recentAttempts.map((item) => {
      const details = describeLearningItem(item.quizId, lookup);
      return {
        id: String(item._id),
        title: details.title,
        subtitle: details.subtitle,
        score: item.score || 0,
        totalQuestions: item.totalQuestions || 0,
        percentage: item.percentage || 0,
        isPassed: Boolean(item.isPassed),
        isTimedOut: Boolean(item.isTimedOut),
        submittedAt: item.submittedAt,
      };
    });

    res.json({
      user,
      stats: {
        totalAttempts: stats.totalAttempts || 0,
        averageScore: stats.averageScore || 0,
        bestScore: stats.bestScore || 0,
        timedOutAttempts: stats.timedOutAttempts || 0,
        lessonsStarted: progressDocs.length,
        lessonsCleared: progressDocs.filter((item) => item.isCleared).length,
        lessonsMastered: progressDocs.filter((item) => item.isMastered).length,
      },
      continueLearning,
      recentActivity,
    });

    cache.put(cacheKey, {
      user,
      stats: {
        totalAttempts: stats.totalAttempts || 0,
        averageScore: stats.averageScore || 0,
        bestScore: stats.bestScore || 0,
        timedOutAttempts: stats.timedOutAttempts || 0,
        lessonsStarted: progressDocs.length,
        lessonsCleared: progressDocs.filter((item) => item.isCleared).length,
        lessonsMastered: progressDocs.filter((item) => item.isMastered).length,
      },
      continueLearning,
      recentActivity,
    }, 5 * 60 * 1000); 
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: 'Error fetching dashboard' });
  }
};
