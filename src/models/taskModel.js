const { pool } = require('../config/db');

const Task = {
  // Create a new task
  create: async (userId, title, options = {}) => {
    const result = await pool.query(
      `INSERT INTO tasks (
        user_id, title, description, category, 
        priority, ai_generated, university_id, due_date
      ) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
       RETURNING *`,
      [
        userId,
        title,
        options.description || null,
        options.category || null,
        options.priority || 'medium',
        options.ai_generated || false,
        options.university_id || null,
        options.due_date || null
      ]
    );
    return result.rows[0];
  },

  // Find all tasks by user
  findAllByUser: async (userId) => {
    const result = await pool.query(
      'SELECT * FROM tasks WHERE user_id = $1 ORDER BY priority DESC, id ASC',
      [userId]
    );
    return result.rows;
  },

  // Find tasks by category
  findByCategory: async (userId, category) => {
    const result = await pool.query(
      'SELECT * FROM tasks WHERE user_id = $1 AND category = $2 ORDER BY id ASC',
      [userId, category]
    );
    return result.rows;
  },

  // Find pending tasks
  findPending: async (userId) => {
    const result = await pool.query(
      `SELECT * FROM tasks 
       WHERE user_id = $1 AND status = 'pending' 
       ORDER BY priority DESC, due_date ASC NULLS LAST`,
      [userId]
    );
    return result.rows;
  },

  // Mark task as complete
  markComplete: async (taskId, userId) => {
    const result = await pool.query(
      "UPDATE tasks SET status = 'completed', completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND user_id = $2 RETURNING *",
      [taskId, userId]
    );
    return result.rows[0];
  },

  // Mark task as pending (undo complete)
  markPending: async (taskId, userId) => {
    const result = await pool.query(
      "UPDATE tasks SET status = 'pending', completed_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND user_id = $2 RETURNING *",
      [taskId, userId]
    );
    return result.rows[0];
  },

  // Update task
  update: async (taskId, userId, updates) => {
    const fields = [];
    const values = [];
    let paramCount = 1;

    if (updates.title) {
      fields.push(`title = $${paramCount++}`);
      values.push(updates.title);
    }
    if (updates.description !== undefined) {
      fields.push(`description = $${paramCount++}`);
      values.push(updates.description);
    }
    if (updates.category) {
      fields.push(`category = $${paramCount++}`);
      values.push(updates.category);
    }
    if (updates.priority) {
      fields.push(`priority = $${paramCount++}`);
      values.push(updates.priority);
    }
    if (updates.due_date) {
      fields.push(`due_date = $${paramCount++}`);
      values.push(updates.due_date);
    }

    if (fields.length === 0) return null;

    values.push(taskId, userId);
    const query = `UPDATE tasks SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${paramCount++} AND user_id = $${paramCount} RETURNING *`;

    const result = await pool.query(query, values);
    return result.rows[0];
  },

  // Delete task
  delete: async (taskId, userId) => {
    const result = await pool.query(
      'DELETE FROM tasks WHERE id = $1 AND user_id = $2 RETURNING *',
      [taskId, userId]
    );
    return result.rows[0];
  },

  // Delete all AI-generated tasks for a user
  deleteAIGenerated: async (userId) => {
    const result = await pool.query(
      'DELETE FROM tasks WHERE user_id = $1 AND ai_generated = true RETURNING *',
      [userId]
    );
    return result.rows;
  },

  // Delete all tasks associated with a specific university
  deleteByUniversity: async (userId, universityId) => {
    const result = await pool.query(
      'DELETE FROM tasks WHERE user_id = $1 AND university_id = $2 RETURNING *',
      [userId, universityId]
    );
    return result.rows;
  },

  // Bulk create tasks
  bulkCreate: async (userId, tasks) => {
    const values = tasks.map((task, idx) => {
      const base = idx * 8;
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8})`;
    }).join(', ');

    const params = tasks.flatMap(task => [
      userId,
      task.title,
      task.description || null,
      task.category || null,
      task.priority || 'medium',
      task.ai_generated || false,
      task.university_id || null,
      task.due_date || null
    ]);

    const query = `
      INSERT INTO tasks (user_id, title, description, category, priority, ai_generated, university_id, due_date)
      VALUES ${values}
      RETURNING *
    `;

    const result = await pool.query(query, params);
    return result.rows;
  },

  // Get task statistics
  getStats: async (userId) => {
    const result = await pool.query(
      `SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
        COUNT(CASE WHEN priority = 'high' AND status = 'pending' THEN 1 END) as high_priority
       FROM tasks 
       WHERE user_id = $1`,
      [userId]
    );
    return result.rows[0];
  }
};

module.exports = Task;