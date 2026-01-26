const { pool } = require('../config/db');

const Shortlist = {
  add: async (userId, uni) => {
    const result = await pool.query(
      `INSERT INTO shortlists (user_id, uni_name, country, data, category) 
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [userId, uni.uni_name, uni.country, uni.data, uni.category]
    );
    return result.rows[0];
  },

  findAllByUser: async (userId) => {
    const result = await pool.query('SELECT * FROM shortlists WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
    return result.rows;
  },

  findById: async (id) => {
    const result = await pool.query('SELECT * FROM shortlists WHERE id = $1', [id]);
    return result.rows[0];
  }
};

module.exports = Shortlist;