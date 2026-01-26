const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes("localhost") 
    ? false 
    : { rejectUnauthorized: false }
});

const connectDB = async () => {
  try {
    await pool.connect();
    console.log("✅ PostgreSQL Connected Successfully");
    
    // 1. Users Table (Updated with locked_university_id)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        otp VARCHAR(10),
        otp_expires TIMESTAMP,
        stage INT DEFAULT 1, -- 1: Profile, 2: Search, 3: Shortlist, 4: Locked
        profile_data JSONB DEFAULT '{}', -- Stores { gpa, budget, country, exam_scores }
        locked_university_id INT, -- Stores the ID of the final choice
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("✅ Users Table Checked/Created");

    // 2. Shortlists Table (New!)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS shortlists (
        id SERIAL PRIMARY KEY,
        user_id INT REFERENCES users(id) ON DELETE CASCADE,
        uni_name VARCHAR(255) NOT NULL,
        country VARCHAR(100),
        data JSONB, -- Stores tuition, ranking, etc. from AI
        category VARCHAR(20), -- 'Safe', 'Target', 'Dream'
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("✅ Shortlists Table Checked/Created");

    // 3. Tasks Table (New!)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        id SERIAL PRIMARY KEY,
        user_id INT REFERENCES users(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'completed'
        due_date TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("✅ Tasks Table Checked/Created");
    
  } catch (err) {
    console.error("❌ Database Connection Failed:", err.message);
    process.exit(1);
  }
};

module.exports = { pool, connectDB };