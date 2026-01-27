const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { requireOnboarding } = require('../middleware/onboardingMiddleware');
const {
    chatWithCounsellor,
    getConversation,
    clearConversation,
    streamChatWithCounsellor,
    getConversations,
    createConversation,
    deleteConversation,
    loadConversation
} = require('../controllers/aiController');

// @route   POST /api/ai/chat
// @access  Private (requires onboarding)
router.post('/chat', protect, requireOnboarding, chatWithCounsellor);

// @route   POST /api/ai/chat/stream
// @access  Private (requires onboarding) - SSE streaming endpoint
router.post('/chat/stream', protect, requireOnboarding, streamChatWithCounsellor);

// @route   GET /api/ai/conversations
// @access  Private - List all conversations
router.get('/conversations', protect, getConversations);

// @route   POST /api/ai/conversations/new
// @access  Private - Create new conversation
router.post('/conversations/new', protect, createConversation);

// @route   GET /api/ai/conversations/:id
// @access  Private - Load specific conversation
router.get('/conversations/:id', protect, loadConversation);

// @route   DELETE /api/ai/conversations/:id
// @access  Private - Delete conversation
router.delete('/conversations/:id', protect, deleteConversation);

// Legacy routes (kept for compatibility)
router.get('/conversation/:id', protect, getConversation);
router.delete('/conversation/:id', protect, clearConversation);

module.exports = router;