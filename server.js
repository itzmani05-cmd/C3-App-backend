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
const { runPushOutboxSweep, runPushReceiptSweep } = require('./services/notification.service');

const app=express();
connectDB();

app.use(cors());
app.use(express.json());

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5000,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

app.get('/api/test', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/auth',authRoutes);
app.use('/api/quiz',quizRoutes);
app.use('/api/content',contentRoutes);
app.use('/api/progress',progressRoutes);
app.use('/api/user',userRoutes);
app.use('/api/daily-challenge',dailyChallengeRoutes);
app.use('/api/notifications',notificationRoutes);

const REMINDER_SWEEP_INTERVAL_MS = 15 * 60 * 1000;
let reminderSweepRunning = false;

function scheduleDailyChallengeReminderSweep() {
  if (reminderSweepRunning) return;
  reminderSweepRunning = true;
  runDailyChallengeReminderSweep()
    .catch((err) => console.error('[dailyChallengeReminderJob] sweep error:', err.message))
    .finally(() => {
      reminderSweepRunning = false;
    });
}

setInterval(scheduleDailyChallengeReminderSweep, REMINDER_SWEEP_INTERVAL_MS);
scheduleDailyChallengeReminderSweep();

function runExclusive(name, intervalMs, task) {
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    task()
      .catch((err) => console.error(`[${name}] sweep error:`, err.message))
      .finally(() => {
        running = false;
      });
  };
  setInterval(tick, intervalMs);
  tick();
}

runExclusive('pushOutbox', 60 * 1000, runPushOutboxSweep);
runExclusive('pushReceipts', 15 * 60 * 1000, runPushReceiptSweep);

const PORT = process.env.PORT || 5000;
app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
});
