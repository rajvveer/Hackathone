// IMPORT THE MODEL (This is what was missing)
const Shortlist = require('../models/shortlistModel'); 
const { pool } = require('../config/db');

// @desc    Add University to Shortlist
const addToShortlist = async (req, res) => {
  const { uni_name, country, data, category } = req.body;
  
  try {
    // OLD WAY: await pool.query(...)
    // NEW WAY: Use Model
    const newShortlist = await Shortlist.add(req.user.id, { uni_name, country, data, category });
    
    res.json(newShortlist);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
};

// @desc    Get My Shortlist
const getShortlist = async (req, res) => {
  try {
    // NEW WAY: Use Model
    const list = await Shortlist.findAllByUser(req.user.id);
    res.json(list);
  } catch (err) {
    res.status(500).send('Server Error');
  }
};

// @desc    LOCK University
const lockUniversity = async (req, res) => {
  const { shortlist_id } = req.body;

  try {
    // 1. Update User Stage (Keep logic here or move to User Model)
    await pool.query(
      'UPDATE users SET stage = 4, locked_university_id = $1 WHERE id = $2',
      [shortlist_id, req.user.id]
    );

    // 2. Generate Default Tasks
    const defaultTasks = [
      "Draft Statement of Purpose (SOP)",
      "Request Letter of Recommendations (LOR)",
      "Check Visa Requirements",
      "Apply for Transcripts"
    ];

    // We can leave this raw or make a Task.createMany() function later
    for (const task of defaultTasks) {
      await pool.query('INSERT INTO tasks (user_id, title) VALUES ($1, $2)', [req.user.id, task]);
    }

    res.json({ msg: "University Locked & Tasks Generated!" });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
};

module.exports = { addToShortlist, getShortlist, lockUniversity };