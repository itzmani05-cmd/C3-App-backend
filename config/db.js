const mongoose=require('mongoose');

const connectDB=async()=>{
    try{
        await mongoose.connect('mongodb+srv://mali2403717710622031_db_user:Uh4zTGzaftBe39Qn@cluster0.rj0fosb.mongodb.net/quizApp');
        console.log("MongoDB Connected");
    }
    catch(err){
        console.error(err);
        process.exit(1);
    }
};

module.exports=connectDB;