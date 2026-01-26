const { pool } = require('../config/db');

const Task = {
  create: async (userId, title) => {
    const result = await pool.query(
      'INSERT INTO tasks (user_id, title) VALUES ($1, $2) RETURNING *',
      [userId, title]
    );
    return result.rows[0];
  },

  findAllByUser: async (userId) => {
    const result = await pool.query('SELECT * FROM tasks WHERE user_id = $1 ORDER BY id ASC', [userId]);
    return result.rows;
  },

  markComplete: async (taskId, userId) => {
    const result = await pool.query(
      "UPDATE tasks SET status = 'completed' WHERE id = $1 AND user_id = $2 RETURNING *", 
      [taskId, userId]
    );
    return result.rows[0];
  }
};

module.exports = Task;