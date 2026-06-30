const mongoose = require('mongoose');

const mongoUri = "mongodb+srv://mali2403717710622031_db_user:Uh4zTGzaftBe39Qn@cluster0.rj0fosb.mongodb.net/quizApp";

const ProgressSchema = new mongoose.Schema({
  userId: mongoose.Schema.Types.ObjectId,
  topicId: mongoose.Schema.Types.ObjectId,
  subtopicId: mongoose.Schema.Types.ObjectId,
  isCleared: Boolean,
  isMastered: Boolean
});

const Progress = mongoose.model('Progress', ProgressSchema);

async function run() {
  await mongoose.connect(mongoUri);
  console.log("Connected to MongoDB!");

  const progressCount = await Progress.countDocuments();
  console.log("Total progress documents:", progressCount);

  const progressSample = await Progress.find().limit(10).lean();
  console.log("Sample progress documents:", JSON.stringify(progressSample, null, 2));

  await mongoose.disconnect();
}

run().catch(console.error);
