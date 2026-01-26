const router = require('express').Router();
const { getTasks, completeTask } = require('../controllers/taskController');
const { protect } = require('../middleware/authMiddleware');

router.get('/', protect, getTasks);
router.put('/:id/complete', protect, completeTask);

module.exports = router;