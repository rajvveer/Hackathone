const { pool } = require('../config/db');

const Shortlist = {
  // Add university to shortlist with enhanced data
  add: async (userId, uni) => {
    const result = await pool.query(
      `INSERT INTO shortlists (
        user_id, uni_name, country, data, category, 
        fit_score, why_fits, key_risks, acceptance_chance
      ) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
       RETURNING *`,
      [
        userId,
        uni.uni_name,
        uni.country,
        uni.data,
        uni.category,
        uni.fit_score || null,
        uni.why_fits || null,
        uni.key_risks || null,
        uni.acceptance_chance || null
      ]
    );
    return result.rows[0];
  },

  // Find all shortlists for a user
  findAllByUser: async (userId) => {
    const result = await pool.query(
      'SELECT * FROM shortlists WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );
    return result.rows;
  },

  // Find shortlist by ID
  findById: async (id) => {
    const result = await pool.query('SELECT * FROM shortlists WHERE id = $1', [id]);
    return result.rows[0];
  },

  // Mark university as locked
  lock: async (id) => {
    const result = await pool.query(
      'UPDATE shortlists SET is_locked = TRUE WHERE id = $1 RETURNING *',
      [id]
    );
    return result.rows[0];
  },

  // Unlock university
  unlock: async (id) => {
    const result = await pool.query(
      'UPDATE shortlists SET is_locked = FALSE WHERE id = $1 RETURNING *',
      [id]
    );
    return result.rows[0];
  },

  // Update fit analysis for existing shortlist
  updateFitAnalysis: async (id, fitData) => {
    const result = await pool.query(
      `UPDATE shortlists 
       SET fit_score = $1, 
           why_fits = $2, 
           key_risks = $3, 
           acceptance_chance = $4
       WHERE id = $5 
       RETURNING *`,
      [fitData.fit_score, fitData.why_fits, fitData.key_risks, fitData.acceptance_chance, id]
    );
    return result.rows[0];
  },

  // Delete shortlist by ID
  delete: async (id, userId) => {
    const result = await pool.query(
      'DELETE FROM shortlists WHERE id = $1 AND user_id = $2 RETURNING *',
      [id, userId]
    );
    return result.rows[0];
  },

  // Get count by category for user
  getCountByCategory: async (userId) => {
    const result = await pool.query(
      `SELECT category, COUNT(*) as count 
       FROM shortlists 
       WHERE user_id = $1 
       GROUP BY category`,
      [userId]
    );
    return result.rows;
  }
};

module.exports = Shortlist;