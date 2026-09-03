require('dotenv').config();

const express=require('express');
const cors=require('cors');
const rateLimit = require('express-rate-limit');
const connectDB=require('./config/db');

const authRoutes=require('./routes/auth.routes');
const quizRoutes=require('./routes/quiz.routes');
const contentRoutes=require('./routes/content.routes');
const userRoutes=require('./routes/user.routes');
const progressRoutes=require('./routes/progress.routes');
const dailyChallengeRoutes=require('./routes/dailyChallenge.routes');
const notificationRoutes=require('./routes/notification.routes');
const { runDailyChallengeReminderSweep } = require('./jobs/dailyChallengeReminderJob');

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
app.use('/api/progress',progressRoutes);
app.use('/api/user',userRoutes);
app.use('/api/daily-challenge',dailyChallengeRoutes);
app.use('/api/notifications',notificationRoutes);

const REMINDER_SWEEP_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
let reminderSweepRunning = false;

function scheduleDailyChallengeReminderSweep() {
  if (reminderSweepRunning) return; // guard against overlapping runs if a sweep is still in flight
  reminderSweepRunning = true;
  runDailyChallengeReminderSweep()
    .catch((err) => console.error('[dailyChallengeReminderJob] sweep error:', err.message))
    .finally(() => {
      reminderSweepRunning = false;
    });
}

setInterval(scheduleDailyChallengeReminderSweep, REMINDER_SWEEP_INTERVAL_MS);
scheduleDailyChallengeReminderSweep();

const PORT = process.env.PORT || 5000;
app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
});
