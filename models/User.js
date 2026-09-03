const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: String,
  email: String,
  password: String,
  role: { type: String, default: "student" },
  status: String,
  examIds: [mongoose.Schema.Types.ObjectId],
  isActive: Boolean,
  expoPushToken: String,
  createdAt: Date,
  updatedAt: Date
});

module.exports = mongoose.model('User', userSchema);