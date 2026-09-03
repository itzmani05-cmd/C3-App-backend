const mongoose = require('mongoose');

const testSchema = new mongoose.Schema({
  examId: mongoose.Schema.Types.ObjectId,
  name: String,
  publishToStudent: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model('Test', testSchema, 'Tests');
