const Task = require('../models/taskModel');

// @desc    Get All Tasks
// @route   GET /api/tasks
const getTasks = async (req, res) => {
  try {
    const { status, category } = req.query;

    let tasks;

    if (status === 'pending') {
      tasks = await Task.findPending(req.user.id);
    } else if (category) {
      tasks = await Task.findByCategory(req.user.id, category);
    } else {
      tasks = await Task.findAllByUser(req.user.id);
    }

    const stats = await Task.getStats(req.user.id);

    res.json({
      tasks,
      stats: {
        total: parseInt(stats.total),
        pending: parseInt(stats.pending),
        completed: parseInt(stats.completed),
        high_priority: parseInt(stats.high_priority),
        completion_rate: stats.total > 0 ?
          Math.round((stats.completed / stats.total) * 100) : 0
      }
    });
  } catch (err) {
    console.error("Get tasks error:", err);
    res.status(500).json({ error: 'Server Error' });
  }
};

// @desc    Create Task
// @route   POST /api/tasks
const createTask = async (req, res) => {
  const { title, description, category, priority, due_date } = req.body;

  try {
    if (!title) {
      return res.status(400).json({ error: "Task title is required" });
    }

    const newTask = await Task.create(req.user.id, title, {
      description,
      category,
      priority: priority || 'medium',
      due_date,
      ai_generated: false
    });

    res.status(201).json({
      ...newTask,
      message: "Task created successfully"
    });
  } catch (err) {
    console.error("Create task error:", err);
    res.status(500).json({ error: 'Server Error' });
  }
};

// @desc    Update Task
// @route   PUT /api/tasks/:id
const updateTask = async (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  try {
    const updatedTask = await Task.update(id, req.user.id, updates);

    if (!updatedTask) {
      return res.status(404).json({ error: "Task not found or no updates provided" });
    }

    res.json({
      ...updatedTask,
      message: "Task updated successfully"
    });
  } catch (err) {
    console.error("Update task error:", err);
    res.status(500).json({ error: 'Server Error' });
  }
};

// @desc    Mark Task as Complete
// @route   PATCH /api/tasks/:id/complete
const markTaskComplete = async (req, res) => {
  const { id } = req.params;

  try {
    const task = await Task.markComplete(id, req.user.id);

    if (!task) {
      return res.status(404).json({ error: "Task not found" });
    }

    res.json({
      ...task,
      message: "Task marked as complete"
    });
  } catch (err) {
    console.error("Mark complete error:", err);
    res.status(500).json({ error: 'Server Error' });
  }
};

// @desc    Mark Task as Pending (undo complete)
// @route   PATCH /api/tasks/:id/pending
const markTaskPending = async (req, res) => {
  const { id } = req.params;

  try {
    const task = await Task.markPending(id, req.user.id);

    if (!task) {
      return res.status(404).json({ error: "Task not found" });
    }

    res.json({
      ...task,
      message: "Task marked as pending"
    });
  } catch (err) {
    console.error("Mark pending error:", err);
    res.status(500).json({ error: 'Server Error' });
  }
};

// @desc    Delete Task
// @route   DELETE /api/tasks/:id
const deleteTask = async (req, res) => {
  const { id } = req.params;

  try {
    const task = await Task.delete(id, req.user.id);

    if (!task) {
      return res.status(404).json({ error: "Task not found" });
    }

    res.json({
      message: "Task deleted successfully",
      deleted: task
    });
  } catch (err) {
    console.error("Delete task error:", err);
    res.status(500).json({ error: 'Server Error' });
  }
};

// @desc    Bulk Create Tasks
// @route   POST /api/tasks/bulk
const bulkCreateTasks = async (req, res) => {
  const { tasks } = req.body;

  try {
    if (!Array.isArray(tasks) || tasks.length === 0) {
      return res.status(400).json({ error: "Tasks array is required" });
    }

    const createdTasks = await Task.bulkCreate(req.user.id, tasks);

    res.status(201).json({
      tasks: createdTasks,
      count: createdTasks.length,
      message: `${createdTasks.length} tasks created successfully`
    });
  } catch (err) {
    console.error("Bulk create tasks error:", err);
    res.status(500).json({ error: 'Server Error' });
  }
};

module.exports = {
  getTasks,
  createTask,
  updateTask,
  markTaskComplete,
  markTaskPending,
  deleteTask,
  bulkCreateTasks
};