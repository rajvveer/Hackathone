const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { requireOnboarding } = require('../middleware/onboardingMiddleware');
const { getDashboardStats } = require('../controllers/dashboardController');

// @route   GET /api/dashboard
// @access  Private (requires onboarding)
router.get('/', protect, requireOnboarding, getDashboardStats);

module.exports = router;