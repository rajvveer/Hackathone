const { pool } = require('../config/db');

// Get Tasks
const getTasks = async (req, res) => {
  try {
    const tasks = await pool.query('SELECT * FROM tasks WHERE user_id = $1 ORDER BY id ASC', [req.user.id]);
    res.json(tasks.rows);
  } catch (err) {
    res.status(500).send('Server Error');
  }
};

// Complete Task
const completeTask = async (req, res) => {
  try {
    await pool.query("UPDATE tasks SET status = 'completed' WHERE id = $1 AND user_id = $2", [req.params.id, req.user.id]);
    res.json({ msg: "Task Completed" });
  } catch (err) {
    res.status(500).send('Server Error');
  }
};

module.exports = { getTasks, completeTask };