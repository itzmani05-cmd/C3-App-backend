const Feedback = require('../models/Feedback');
const User = require('../models/User');
const { validateFeedback } = require('../utils/feedback');

const MAX_PER_HOUR = 5;
const HOUR_MS = 60 * 60 * 1000;

exports.submitFeedback = async (req, res) => {
  try {
    const userId = req.userId || req.headers.userid;
    if (!userId) return res.status(401).json({ message: 'User not authenticated' });

    const { error, value } = validateFeedback(req.body);
    if (error) return res.status(400).json({ message: error });

    // A student can send a handful of messages an hour, which stops an accidental double-tap loop or a spam run.
    const recent = await Feedback.countDocuments({ userId, createdAt: { $gte: new Date(Date.now() - HOUR_MS) } });
    if (recent >= MAX_PER_HOUR) {
      return res.status(429).json({ message: 'You have sent a lot of feedback in the last hour. Please try again later.' });
    }

    const student = await User.findById(userId).select('name email').lean();
    const feedback = await Feedback.create({
      ...value,
      userId,
      studentName: student?.name || '',
      studentEmail: student?.email || '',
    });

    res.status(201).json({ message: 'Thanks for your feedback', id: feedback._id });
  } catch (err) {
    console.error('SUBMIT FEEDBACK ERROR:', err);
    res.status(500).json({ message: 'Could not send your feedback. Please try again.' });
  }
};
