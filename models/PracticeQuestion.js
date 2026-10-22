const mongoose = require('mongoose');

// Questions the admin site keeps for practice. They are only read here, for the Practice screen, and have a topic
// but no subtopic. The schema is loose on purpose: the website owns it.
const practiceQuestionSchema = new mongoose.Schema({}, { strict: false });

practiceQuestionSchema.index({ topicId: 1 });

module.exports = mongoose.model('PracticeQuestion', practiceQuestionSchema, 'PracticeQuestion');
