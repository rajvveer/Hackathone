const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { requireOnboarding, requireStage } = require('../middleware/onboardingMiddleware');
const { getApplicationGuidance } = require('../controllers/applicationController');

// @route   GET /api/application/guidance
// @access  Private (requires stage 4 - locked university)
router.get('/guidance', protect, requireStage(4), getApplicationGuidance);

module.exports = router;
