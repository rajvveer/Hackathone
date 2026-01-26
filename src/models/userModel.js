const { pool } = require('../config/db');
const crypto = require('crypto');

const User = {
  // Find user by email
  findByEmail: async (email) => {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    return result.rows[0];
  },

  // Find user by ID
  findById: async (id) => {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    return result.rows[0];
  },

  // Create new user with onboarding flag
  createUser: async (name, email, hashedPassword) => {
    const result = await pool.query(
      `INSERT INTO users (name, email, password, stage, onboarding_completed) 
       VALUES ($1, $2, $3, 1, false) 
       RETURNING id, name, email, stage, onboarding_completed`,
      [name, email, hashedPassword]
    );
    return result.rows[0];
  },

  // Save OTP with expiration
  setOtp: async (email, otp) => {
    const expires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    return await pool.query(
      'UPDATE users SET otp = $1, otp_expires = $2 WHERE email = $3',
      [otp, expires, email]
    );
  },

  // Verify OTP (check expiration)
  verifyOtp: async (email, otp) => {
    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1 AND otp = $2 AND otp_expires > NOW()',
      [email, otp]
    );
    return result.rows[0];
  },

  // Update Password and clear OTP
  resetPassword: async (email, newPassword) => {
    return await pool.query(
      'UPDATE users SET password = $1, otp = NULL, otp_expires = NULL WHERE email = $2',
      [newPassword, email]
    );
  },

  // Update profile data (comprehensive)
  updateProfile: async (userId, profileData) => {
    const result = await pool.query(
      `UPDATE users 
       SET profile_data = $1,
           onboarding_completed = $2,
           stage = CASE WHEN stage = 1 AND $2 = true THEN 2 ELSE stage END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3 
       RETURNING *`,
      [JSON.stringify(profileData), profileData.onboarding_completed || false, userId]
    );
    return result.rows[0];
  },

  // Update stage only
  updateStage: async (userId, stage) => {
    const result = await pool.query(
      'UPDATE users SET stage = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
      [stage, userId]
    );
    return result.rows[0];
  },

  // Lock university
  lockUniversity: async (userId, shortlistId) => {
    const result = await pool.query(
      `UPDATE users 
       SET stage = 4, 
           locked_university_id = $1, 
           locked_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 
       RETURNING *`,
      [shortlistId, userId]
    );
    return result.rows[0];
  },

  // Unlock university
  unlockUniversity: async (userId) => {
    const result = await pool.query(
      `UPDATE users 
       SET stage = 3, 
           locked_university_id = NULL, 
           locked_at = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 
       RETURNING *`,
      [userId]
    );
    return result.rows[0];
  },

  // Check if onboarding is complete
  isOnboardingComplete: async (userId) => {
    const result = await pool.query(
      'SELECT onboarding_completed FROM users WHERE id = $1',
      [userId]
    );
    return result.rows[0]?.onboarding_completed || false;
  },

  // Get profile hash for recommendation caching
  getProfileHash: (profileData) => {
    const relevant = {
      gpa: profileData.gpa,
      gpa_scale: profileData.gpa_scale,
      budget_range_min: profileData.budget_range_min,
      budget_range_max: profileData.budget_range_max,
      preferred_countries: profileData.preferred_countries,
      intended_degree: profileData.intended_degree,
      field_of_study: profileData.field_of_study
    };
    return crypto.createHash('md5').update(JSON.stringify(relevant)).digest('hex');
  }
};

module.exports = User;