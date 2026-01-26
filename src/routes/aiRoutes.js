const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { requireOnboarding } = require('../middleware/onboardingMiddleware');
const { chatWithCounsellor, getConversation, clearConversation } = require('../controllers/aiController');

// @route   POST /api/ai/chat
// @access  Private (requires onboarding)
router.post('/chat', protect, requireOnboarding, chatWithCounsellor);

// @route   GET /api/ai/conversation/:id
// @access  Private
router.get('/conversation/:id', protect, getConversation);

// @route   DELETE /api/ai/conversation/:id
// @access  Private
router.delete('/conversation/:id', protect, clearConversation);

module.exports = router;