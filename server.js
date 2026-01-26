const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { connectDB } = require('./src/config/db');

dotenv.config();
connectDB(); 

const app = express();
app.use(express.json());
app.use(cors());

app.use('/api/auth', require('./src/routes/authRoutes'));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));