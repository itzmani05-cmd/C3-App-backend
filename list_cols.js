const mongoose = require('mongoose');
require('dotenv').config();

async function check() {
  const uri = process.env.MONGO_URI || 'mongodb+srv://mali2403717710622031_db_user:Uh4zTGzaftBe39Qn@cluster0.rj0fosb.mongodb.net/quizApp';
  await mongoose.connect(uri);
  const collections = await mongoose.connection.db.listCollections().toArray();
  console.log("COLLECTIONS_START");
  collections.forEach(c => console.log(c.name));
  console.log("COLLECTIONS_END");
  process.exit();
}

check().catch(err => {
  console.error(err);
  process.exit(1);
});
