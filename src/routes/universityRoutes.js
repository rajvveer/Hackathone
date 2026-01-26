const router = require('express').Router();
const { search } = require('../controllers/universityController');

router.get('/search', search);

module.exports = router;