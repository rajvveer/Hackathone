const router = require('express').Router();
const { chatWithCounsellor } = require('../controllers/aiController');
const { protect } = require('../middleware/authMiddleware');

router.post('/chat', protect, chatWithCounsellor);

module.exports = router;