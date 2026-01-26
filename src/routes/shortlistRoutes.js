const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
    addToShortlist,
    getShortlist,
    removeFromShortlist,
    lockUniversity,
    unlockUniversity
} = require('../controllers/shortlistController');

// @route   GET /api/shortlist
// @access  Private
router.get('/', protect, getShortlist);

// @route   POST /api/shortlist
// @access  Private
router.post('/', protect, addToShortlist);

// @route   DELETE /api/shortlist/:id
// @access  Private
router.delete('/:id', protect, removeFromShortlist);

// @route   POST /api/shortlist/lock
// @access  Private
router.post('/lock', protect, lockUniversity);

// @route   POST /api/shortlist/unlock
// @access  Private
router.post('/unlock', protect, unlockUniversity);

module.exports = router;