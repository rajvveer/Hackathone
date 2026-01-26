const router = require('express').Router();
const { addToShortlist, getShortlist, lockUniversity } = require('../controllers/shortlistController');
const { protect } = require('../middleware/authMiddleware');

router.post('/', protect, addToShortlist);
router.get('/', protect, getShortlist);
router.post('/lock', protect, lockUniversity);

module.exports = router;