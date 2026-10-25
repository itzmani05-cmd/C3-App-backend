# C3App — Server

A lightweight and scalable **Node.js + Express backend** for the **C3 Institute Learning Platform**.

This backend provides secure REST APIs for **authentication, quizzes, questions, learning content, progress tracking, and admin operations**. Built using **Express** and **MongoDB**, it is designed for seamless integration with frontend applications or Learning Management Systems (LMS).

---

## 🚀 Features

- 🔐 JWT-based Authentication
- 👤 User Registration & Login
- 📝 Quiz & Question Management
- 📊 Attempt Tracking & Scoring
- 📚 Learning Content Organization (Topics, Units, Subtopics)
- 📈 User Progress Tracking
- 👨‍💼 Admin Management APIs
- 📁 File Upload Support
- ⚡ RESTful API Architecture

---

## 🛠️ Tech Stack

### Backend
- Node.js
- Express.js
- MongoDB
- Mongoose

### Authentication
- JSON Web Token (JWT)

### Development Tools
- Nodemon
- dotenv

---

## 📂 Project Structure

```bash
C3App-Server/
│── config/             # Database configuration
│── controllers/        # Request handlers
│── middleware/         # Authentication & middleware
│── models/             # Mongoose models
│── routes/             # Express routes
│── utils/              # Helper utilities
│── uploads/            # Uploaded files (if applicable)
│── .env                # Environment variables
│── app.js / server.js  # Entry point
│── package.json

---

## 🌐 Browser access (CORS)

The mobile app is not affected by CORS. Websites are blocked unless they are listed in `CORS_ORIGINS`, a comma-separated
list set in `.env` (or the host's environment settings):

```
CORS_ORIGINS=https://your-site.example,https://www.your-site.example
```

Pages served from `localhost` / `127.0.0.1` are always allowed so local development keeps working.
