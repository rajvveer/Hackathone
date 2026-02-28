const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { connectDB } = require('./src/config/db');
const { notFound, errorHandler } = require('./src/middleware/errorMiddleware');

dotenv.config();
connectDB();

const app = express();
app.use(express.json());

const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:5173',
    'https://magnificent-moonbeam-d40544.netlify.app'
];

app.use(cors({
    origin: function (origin, callback) {
        // allow requests with no origin (like mobile apps or curl requests)
        // or requests exactly matching one of the allowed origins
        if (!origin || allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
}));

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'OK', message: 'Server is running' });
});

// --- ROUTES ---
app.use('/api/auth', require('./src/routes/authRoutes'));
app.use('/api/user', require('./src/routes/userRoutes'));
app.use('/api/dashboard', require('./src/routes/dashboardRoutes'));
app.use('/api/ai', require('./src/routes/aiRoutes'));
app.use('/api/recommendations', require('./src/routes/recommendationRoutes'));
app.use('/api/shortlist', require('./src/routes/shortlistRoutes'));
app.use('/api/tasks', require('./src/routes/taskRoutes'));
app.use('/api/application', require('./src/routes/applicationRoutes'));
app.use('/api/universities', require('./src/routes/universityRoutes'));

// --- ERROR HANDLERS (Must be after routes) ---
app.use(notFound);      // Catches 404 errors (invalid URLs)
app.use(errorHandler);  // Catches 500 errors (server crashes)

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));