const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { getProfile, updateProfile } = require('../controllers/userController');

// @route   GET /api/user/profile
// @access  Private
router.get('/profile', protect, getProfile);

// @route   PUT /api/user/profile
// @access  Private
router.put('/profile', protect, updateProfile);

module.exports = router;