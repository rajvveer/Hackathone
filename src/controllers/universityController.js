const { searchUniversities } = require('../services/universityService');

// @desc    Search Universities (Public or Private)
// @route   GET /api/universities/search?country=Canada&name=Tor
const search = async (req, res) => {
  const { country, name } = req.query;

  if (!country && !name) {
    return res.status(400).json({ msg: "Please provide a country or university name" });
  }

  try {
    const results = await searchUniversities(country, name);
    res.json(results);
  } catch (error) {
    res.status(500).send('Server Error');
  }
};

module.exports = { search };