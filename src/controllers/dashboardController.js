const { pool } = require('../config/db');

// @desc    Get Full Dashboard Stats
// @route   GET /api/dashboard
const getDashboardStats = async (req, res) => {
  try {
    const user = req.user;
    const profile = user.profile_data || {};
    
    // 1. Calculate Profile Strength (Logic Based)
    let strength = "Weak";
    let missingFields = [];
    
    if (!profile.gpa) missingFields.push("GPA");
    if (!profile.budget) missingFields.push("Budget");
    if (!profile.country) missingFields.push("Country");
    
    if (missingFields.length === 0) {
      strength = "Average"; // Base level
      // If GPA is high (assuming scale of 4.0 or 10.0), upgrade to Strong
      const gpa = parseFloat(profile.gpa);
      if ((gpa >= 3.5 && gpa <= 4.0) || (gpa >= 8.5 && gpa <= 10.0)) {
        strength = "Strong";
      }
    }

    // 2. Count Shortlisted Unis
    const shortlistCount = await pool.query(
      'SELECT COUNT(*) FROM shortlists WHERE user_id = $1', 
      [user.id]
    );

    // 3. Count Pending Tasks
    const taskCount = await pool.query(
      "SELECT COUNT(*) FROM tasks WHERE user_id = $1 AND status = 'pending'",
      [user.id]
    );

    res.json({
      strength: strength,
      missing_fields: missingFields,
      stats: {
        shortlisted: parseInt(shortlistCount.rows[0].count),
        pending_tasks: parseInt(taskCount.rows[0].count),
        current_stage: user.stage
      }
    });

  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
};

module.exports = { getDashboardStats };