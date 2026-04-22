const mongoose = require('mongoose');
require('dotenv').config();

async function check() {
  const uri = process.env.MONGO_URI || 'mongodb+srv://mali2403717710622031_db_user:Uh4zTGzaftBe39Qn@cluster0.rj0fosb.mongodb.net/quizApp';
  await mongoose.connect(uri);
  console.log("Connected to DB");

  const collections = await mongoose.connection.db.listCollections().toArray();
  console.log("Collections:", collections.map(c => c.name));

  const attemptsCount = await mongoose.connection.db.collection('attempts').countDocuments();
  console.log("Attempts count (plural):", attemptsCount);

  const attemptCount = await mongoose.connection.db.collection('Attempts').countDocuments();
  console.log("Attempt count (capital):", attemptCount);

  const latestPlural = await mongoose.connection.db.collection('attempts').find().sort({ _id: -1 }).limit(1).toArray();
  console.log("Latest in 'attempts':", JSON.stringify(latestPlural, null, 2));

  const latestCapital = await mongoose.connection.db.collection('Attempts').find().sort({ _id: -1 }).limit(1).toArray();
  console.log("Latest in 'Attempts':", JSON.stringify(latestCapital, null, 2));

  process.exit();
}

check().catch(err => {
  console.error(err);
  process.exit(1);
});
