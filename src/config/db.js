const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes("localhost")
    ? false
    : { rejectUnauthorized: false },
  // Performance optimizations for remote databases
  max: 20, // Maximum connections in pool
  idleTimeoutMillis: 30000, // Close idle connections after 30s
  connectionTimeoutMillis: 5000, // Timeout for new connections
  keepAlive: true, // Keep connections alive
  keepAliveInitialDelayMillis: 10000
});

const connectDB = async () => {
  try {
    await pool.connect();
    console.log("✅ PostgreSQL Connected Successfully");

    // 1. Users Table (Enhanced with full profile support)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        otp VARCHAR(10),
        otp_expires TIMESTAMP,
        stage INT DEFAULT 1,
        profile_data JSONB DEFAULT '{}',
        onboarding_completed BOOLEAN DEFAULT FALSE,
        locked_university_id INT,
        locked_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("✅ Users Table Checked/Created");

    // 2. Shortlists Table (Enhanced with fit analysis)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS shortlists (
        id SERIAL PRIMARY KEY,
        user_id INT REFERENCES users(id) ON DELETE CASCADE,
        uni_name VARCHAR(255) NOT NULL,
        country VARCHAR(100),
        data JSONB,
        category VARCHAR(20),
        fit_score INT,
        why_fits TEXT,
        key_risks TEXT[],
        acceptance_chance VARCHAR(20),
        is_locked BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("✅ Shortlists Table Checked/Created");

    // 3. Tasks Table (Enhanced with categories and priorities)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        id SERIAL PRIMARY KEY,
        user_id INT REFERENCES users(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        status VARCHAR(20) DEFAULT 'pending',
        category VARCHAR(50),
        priority VARCHAR(20) DEFAULT 'medium',
        ai_generated BOOLEAN DEFAULT FALSE,
        university_id INT REFERENCES shortlists(id) ON DELETE SET NULL,
        due_date TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("✅ Tasks Table Checked/Created");

    // 4. Conversations Table (NEW - for AI chat history)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS conversations (
        id SERIAL PRIMARY KEY,
        user_id INT REFERENCES users(id) ON DELETE CASCADE,
        messages JSONB DEFAULT '[]',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("✅ Conversations Table Checked/Created");

    // 5. User Recommendations Cache Table (NEW)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_recommendations (
        id SERIAL PRIMARY KEY,
        user_id INT REFERENCES users(id) ON DELETE CASCADE,
        recommendations JSONB NOT NULL,
        profile_hash VARCHAR(64),
        generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("✅ User Recommendations Table Checked/Created");

    // 6. Application Documents Table (NEW)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS application_documents (
        id SERIAL PRIMARY KEY,
        user_id INT REFERENCES users(id) ON DELETE CASCADE,
        university_id INT REFERENCES shortlists(id) ON DELETE CASCADE,
        document_type VARCHAR(100) NOT NULL,
        file_url TEXT,
        status VARCHAR(50) DEFAULT 'not_started',
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("✅ Application Documents Table Checked/Created");

    // Run migrations for existing tables
    await runMigrations();

  } catch (err) {
    console.error("❌ Database Connection Failed:", err.message);
    process.exit(1);
  }
};

// Safe migration function to add columns to existing tables
const runMigrations = async () => {
  const migrations = [
    // Users table enhancements
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT FALSE",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_university_id INT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_at TIMESTAMP",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP",

    // Shortlists table enhancements
    "ALTER TABLE shortlists ADD COLUMN IF NOT EXISTS fit_score INT",
    "ALTER TABLE shortlists ADD COLUMN IF NOT EXISTS why_fits TEXT",
    "ALTER TABLE shortlists ADD COLUMN IF NOT EXISTS key_risks TEXT[]",
    "ALTER TABLE shortlists ADD COLUMN IF NOT EXISTS acceptance_chance VARCHAR(20)",
    "ALTER TABLE shortlists ADD COLUMN IF NOT EXISTS is_locked BOOLEAN DEFAULT FALSE",

    // Tasks table enhancements
    "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS description TEXT",
    "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS category VARCHAR(50)",
    "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS priority VARCHAR(20) DEFAULT 'medium'",
    "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS ai_generated BOOLEAN DEFAULT FALSE",
    "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS university_id INT",
    "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP",
    "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP"
  ];

  for (const migration of migrations) {
    try {
      await pool.query(migration);
    } catch (err) {
      // Column might already exist, safe to ignore
      if (!err.message.includes('already exists')) {
        console.log(`⚠️ Migration note: ${err.message}`);
      }
    }
  }
  console.log("✅ All Migrations Completed");
};

module.exports = { pool, connectDB };