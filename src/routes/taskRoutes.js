const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
    getTasks,
    createTask,
    updateTask,
    markTaskComplete,
    markTaskPending,
    deleteTask,
    bulkCreateTasks
} = require('../controllers/taskController');

// @route   GET /api/tasks
// @access  Private
router.get('/', protect, getTasks);

// @route   POST /api/tasks
// @access  Private
router.post('/', protect, createTask);

// @route   POST /api/tasks/bulk
// @access  Private
router.post('/bulk', protect, bulkCreateTasks);

// @route   PUT /api/tasks/:id
// @access  Private
router.put('/:id', protect, updateTask);

// @route   PATCH /api/tasks/:id/complete
// @access  Private
router.patch('/:id/complete', protect, markTaskComplete);

// @route   PATCH /api/tasks/:id/pending
// @access  Private
router.patch('/:id/pending', protect, markTaskPending);

// @route   DELETE /api/tasks/:id
// @access  Private
router.delete('/:id', protect, deleteTask);

module.exports = router;