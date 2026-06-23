require('dotenv').config();
const express=require('express');
const cors=require('cors');
const rateLimit = require('express-rate-limit');
const connectDB=require('./config/db');

const authRoutes=require('./routes/auth.routes');
const quizRoutes=require('./routes/quiz.routes');
const contentRoutes=require('./routes/content.routes');
const adminRoutes=require('./routes/admin.routes');
const userRoutes=require('./routes/user.routes');
const progressRoutes=require('./routes/progress.routes');

const app=express();
connectDB();

app.use(cors());
app.use(express.json());

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5000, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});
app.use(limiter);

app.use('/api/auth',authRoutes);
app.use('/api/quiz',quizRoutes);
app.use('/api/content',contentRoutes);
app.use('/api/admin',adminRoutes);
app.use('/api/progress',progressRoutes);
app.use('/api/user',userRoutes);

const PORT = process.env.PORT || 5000;
app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
});
