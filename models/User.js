const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: String,
  email: String,
  password: String,
  role: { type: String, default: "student" },
  status: String,
  examIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Exam' }],
  isActive: Boolean,
  expoPushToken: String,
  createdAt: Date,
  updatedAt: Date
});

module.exports = mongoose.model('User', userSchema);