const mongoose = require('mongoose');
require('dotenv').config();

const attemptSchema = new mongoose.Schema({
  userId: mongoose.Schema.Types.ObjectId,
  quizId: mongoose.Schema.Types.ObjectId,
  questionOrder: [mongoose.Schema.Types.ObjectId],
  isSubmitted: Boolean,
}, { strict: false });

const Attempt = mongoose.model('Attempt', attemptSchema);

async function check() {
  const uri = process.env.MONGO_URI || 'mongodb+srv://mali2403717710622031_db_user:Uh4zTGzaftBe39Qn@cluster0.rj0fosb.mongodb.net/quizApp';
  console.log("Connecting to:", uri.replace(/:([^:@]+)@/, ":****@"));
  await mongoose.connect(uri);
  console.log("Connected to DB");

  const latest = await Attempt.findOne().sort({ startedAt: -1 }).lean();
  console.log("Latest Attempt:", JSON.stringify(latest, null, 2));

  process.exit();
}

check().catch(err => {
  console.error(err);
  process.exit(1);
});
