const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { requireOnboarding } = require('../middleware/onboardingMiddleware');
const { getRecommendations, refreshRecommendations } = require('../controllers/recommendationController');

// @route   GET /api/recommendations
// @access  Private (requires onboarding)
router.get('/', protect, requireOnboarding, getRecommendations);

// @route   POST /api/recommendations/refresh
// @access  Private
router.post('/refresh', protect, refreshRecommendations);

module.exports = router;