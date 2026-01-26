const { pool } = require('../config/db');

const User = {
  // Find user by email
  findByEmail: async (email) => {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    return result.rows[0];
  },

  // Create new user
  create: async (name, email, password) => {
    const result = await pool.query(
      'INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING id, name, email, stage',
      [name, email, hashedPassword] // Note: hash the password before passing it here, or inside here.
      // Actually, better to pass hashed password from controller.
    );
    return result.rows[0];
  },
  
  // Create user (Fixed version to accept hashed password)
  createUser: async (name, email, hashedPassword) => {
      const result = await pool.query(
      'INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING id, name, email, stage',
      [name, email, hashedPassword]
    );
    return result.rows[0];
  },

  // Save OTP
  setOtp: async (email, otp) => {
    return await pool.query('UPDATE users SET otp = $1 WHERE email = $2', [otp, email]);
  },

  // Update Password
  resetPassword: async (email, newPassword) => {
    return await pool.query('UPDATE users SET password = $1, otp = NULL WHERE email = $2', [newPassword, email]);
  }
};

module.exports = User;