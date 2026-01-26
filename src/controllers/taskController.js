// IMPORT THE MODEL
const Task = require('../models/taskModel');

// Get Tasks
const getTasks = async (req, res) => {
  try {
    // Use Model
    const tasks = await Task.findAllByUser(req.user.id);
    res.json(tasks);
  } catch (err) {
    res.status(500).send('Server Error');
  }
};

// Complete Task
const completeTask = async (req, res) => {
  try {
    // Use Model
    await Task.markComplete(req.params.id, req.user.id);
    res.json({ msg: "Task Completed" });
  } catch (err) {
    res.status(500).send('Server Error');
  }
};

module.exports = { getTasks, completeTask };