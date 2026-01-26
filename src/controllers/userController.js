const { pool } = require('../config/db');

// @desc    Get User Profile (Dashboard load)
// @route   GET /api/user/profile
const getProfile = async (req, res) => {
  try {
    // req.user comes from the 'protect' middleware
    res.json(req.user); 
  } catch (err) {
    res.status(500).send('Server Error');
  }
};

// @desc    Update Profile (Finish Onboarding)
// @route   PUT /api/user/profile
const updateProfile = async (req, res) => {
  const { gpa, budget, country, degree } = req.body;
  
  try {
    // 1. Update Profile Data JSON
    // 2. Move Stage from 1 (Profile) to 2 (Discovery)
    const updatedUser = await pool.query(
      `UPDATE users 
       SET profile_data = $1, stage = CASE WHEN stage = 1 THEN 2 ELSE stage END 
       WHERE id = $2 RETURNING *`,
      [JSON.stringify({ gpa, budget, country, degree }), req.user.id]
    );

    res.json(updatedUser.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
};

module.exports = { getProfile, updateProfile };