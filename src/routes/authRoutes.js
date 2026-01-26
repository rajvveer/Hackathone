const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { registerUser, loginUser, forgotPassword, verifyOtp, resetPassword } = require('../controllers/authController');

// @route   POST /api/auth/register
router.post('/register', registerUser);

// @route   POST /api/auth/login
router.post('/login', loginUser);

// @route   POST /api/auth/forgot-password
router.post('/forgot-password', forgotPassword);

// @route   POST /api/auth/verify-otp
router.post('/verify-otp', verifyOtp);

// @route   POST /api/auth/reset-password
router.post('/reset-password', resetPassword);

module.exports = router;