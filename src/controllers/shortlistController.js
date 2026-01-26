const { pool } = require('../config/db');

// @desc    Add University to Shortlist
// @route   POST /api/shortlist
const addToShortlist = async (req, res) => {
  const { uni_name, country, data, category } = req.body;
  
  try {
    const newShortlist = await pool.query(
      `INSERT INTO shortlists (user_id, uni_name, country, data, category) 
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.user.id, uni_name, country, data, category]
    );
    res.json(newShortlist.rows[0]);
  } catch (err) {
    res.status(500).send('Server Error');
  }
};

// @desc    Get My Shortlist
// @route   GET /api/shortlist
const getShortlist = async (req, res) => {
  try {
    const list = await pool.query('SELECT * FROM shortlists WHERE user_id = $1', [req.user.id]);
    res.json(list.rows);
  } catch (err) {
    res.status(500).send('Server Error');
  }
};

// @desc    LOCK University (The Big Commitment)
// @route   POST /api/shortlist/lock
const lockUniversity = async (req, res) => {
  const { shortlist_id } = req.body; // The ID of the row in shortlists table

  try {
    // 1. Update User Stage to 4 (Locked)
    // 2. Save the Locked ID
    await pool.query(
      'UPDATE users SET stage = 4, locked_university_id = $1 WHERE id = $2',
      [shortlist_id, req.user.id]
    );

    // 3. AUTO-GENERATE TASKS (The "Smart" Feature)
    // We insert default tasks immediately upon locking
    const defaultTasks = [
      "Draft Statement of Purpose (SOP)",
      "Request Letter of Recommendations (LOR)",
      "Check Visa Requirements",
      "Apply for Transcripts"
    ];

    for (const task of defaultTasks) {
      await pool.query(
        'INSERT INTO tasks (user_id, title) VALUES ($1, $2)',
        [req.user.id, task]
      );
    }

    res.json({ msg: "University Locked & Tasks Generated!" });

  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
};

module.exports = { addToShortlist, getShortlist, lockUniversity };