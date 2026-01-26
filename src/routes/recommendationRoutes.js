const router = require('express').Router();
const { getRecommendations } = require('../controllers/recommendationController');
const { protect } = require('../middleware/authMiddleware');

router.get('/', protect, getRecommendations);
module.exports = router;