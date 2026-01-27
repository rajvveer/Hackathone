const Shortlist = require('../models/shortlistModel');
const Task = require('../models/taskModel');
const User = require('../models/userModel');
const { pool } = require('../config/db');

// @desc    Add University to Shortlist
// @route   POST /api/shortlist
const addToShortlist = async (req, res) => {
  const { uni_name, country, data, category, fit_score, why_fits, key_risks, acceptance_chance } = req.body;

  try {
    // Validate required fields
    if (!uni_name || !country) {
      return res.status(400).json({ error: "University name and country are required" });
    }

    // Check if already shortlisted
    const existing = await pool.query(
      'SELECT * FROM shortlists WHERE user_id = $1 AND uni_name = $2',
      [req.user.id, uni_name]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({
        error: "University already shortlisted",
        shortlist_id: existing.rows[0].id
      });
    }

    const newShortlist = await Shortlist.add(req.user.id, {
      uni_name,
      country,
      data,
      category: category || 'Target',
      fit_score,
      why_fits,
      key_risks,
      acceptance_chance
    });

    // Update user stage if needed (move from stage 1 or 2 to 3 if they have shortlists)
    if (req.user.stage < 3) {
      const shortlistCount = await pool.query(
        'SELECT COUNT(*) FROM shortlists WHERE user_id = $1',
        [req.user.id]
      );

      if (parseInt(shortlistCount.rows[0].count) >= 1) {
        await User.updateStage(req.user.id, 3);
      }
    }

    res.json({
      ...newShortlist,
      message: "University added to your shortlist"
    });
  } catch (err) {
    console.error("Add to shortlist error:", err);
    res.status(500).json({ error: 'Server Error' });
  }
};

// @desc    Get My Shortlist
// @route   GET /api/shortlist
const getShortlist = async (req, res) => {
  try {
    const list = await Shortlist.findAllByUser(req.user.id);

    // Get category breakdown
    const categoryCounts = await Shortlist.getCountByCategory(req.user.id);

    res.json({
      shortlists: list,
      total: list.length,
      by_category: categoryCounts.reduce((acc, cat) => {
        acc[cat.category.toLowerCase()] = parseInt(cat.count);
        return acc;
      }, {}),
      locked_id: req.user.locked_university_id
    });
  } catch (err) {
    console.error("Get shortlist error:", err);
    res.status(500).json({ error: 'Server Error' });
  }
};

// @desc    Remove from Shortlist
// @route   DELETE /api/shortlist/:id
const removeFromShortlist = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if this is the locked university
    if (req.user.locked_university_id && parseInt(req.user.locked_university_id) === parseInt(id)) {
      return res.status(400).json({
        error: "Cannot remove locked university",
        message: "Please unlock the university first before removing it"
      });
    }

    const deleted = await Shortlist.delete(id, req.user.id);

    if (!deleted) {
      return res.status(404).json({ error: "Shortlist not found" });
    }

    res.json({
      message: "University removed from shortlist",
      removed: deleted
    });
  } catch (err) {
    console.error("Remove from shortlist error:", err);
    res.status(500).json({ error: 'Server Error' });
  }
};

// Helper: Generate university-specific tasks
const generateUniversityTasks = (shortlist, profile) => {
  const country = shortlist.country;
  const uniName = shortlist.uni_name;
  const intake = profile.target_intake_season || 'Fall';
  const year = profile.target_intake_year || new Date().getFullYear() + 1;

  const baseTasks = [
    {
      title: `Research ${uniName} application requirements and deadlines`,
      description: `Check official website for ${intake} ${year} intake deadlines`,
      category: "research",
      priority: "high",
      ai_generated: true
    },
    {
      title: "Draft Statement of Purpose (SOP)",
      description: `Tailor SOP specifically for ${uniName}'s ${profile.field_of_study} program`,
      category: "sop",
      priority: "high",
      ai_generated: true
    },
    {
      title: "Request Letters of Recommendation (LOR)",
      description: "Get 2-3 strong LORs from professors or supervisors",
      category: "lor",
      priority: "high",
      ai_generated: true
    },
    {
      title: "Prepare academic transcripts",
      description: "Get official transcripts from all institutions attended",
      category: "documents",
      priority: "high",
      ai_generated: true
    }
  ];

  // Country-specific tasks
  const countryTasks = {
    "USA": [
      {
        title: "Check I-20 form requirements",
        description: `Review ${uniName}'s I-20 issuance process`,
        category: "visa",
        priority: "medium",
        ai_generated: true
      },
      {
        title: "Prepare for F-1 visa interview",
        description: "Gather financial documents and prepare answers",
        category: "visa",
        priority: "medium",
        ai_generated: true
      },
      {
        title: "Take TOEFL/IELTS if not done",
        description: "Most US universities require English proficiency test",
        category: "exams",
        priority: "high",
        ai_generated: true
      }
    ],
    "UK": [
      {
        title: "Check CAS letter requirements",
        description: `Research ${uniName}'s CAS issuance timeline`,
        category: "visa",
        priority: "medium",
        ai_generated: true
      },
      {
        title: "Prepare for UK Student Visa application",
        description: "Gather documents for Tier 4 / Student Route visa",
        category: "visa",
        priority: "medium",
        ai_generated: true
      }
    ],
    "Canada": [
      {
        title: "Apply for study permit",
        description: "Research Canadian study permit requirements",
        category: "visa",
        priority: "high",
        ai_generated: true
      },
      {
        title: "Get provincial attestation letter (PAL)",
        description: "Required for study permit as of 2024",
        category: "visa",
        priority: "high",
        ai_generated: true
      }
    ],
    "Germany": [
      {
        title: "Check if Blocked Account is required",
        description: "Most German universities require proof of funds via blocked account",
        category: "visa",
        priority: "high",
        ai_generated: true
      },
      {
        title: "Research APS certificate requirement",
        description: "Check if Academic Evaluation Centre certificate is needed",
        category: "documents",
        priority: "medium",
        ai_generated: true
      }
    ],
    "Australia": [
      {
        title: "Check GTE (Genuine Temporary Entrant) requirements",
        description: "Prepare statement for Australian student visa",
        category: "visa",
        priority: "high",
        ai_generated: true
      }
    ]
  };

  const tasks = [...baseTasks];

  if (countryTasks[country]) {
    tasks.push(...countryTasks[country]);
  }

  return tasks;
};

// @desc    LOCK University
// @route   POST /api/shortlist/lock
const lockUniversity = async (req, res) => {
  const { shortlist_id } = req.body;

  try {
    // Validate shortlist exists and belongs to user
    const shortlist = await Shortlist.findById(shortlist_id);

    if (!shortlist || shortlist.user_id !== req.user.id) {
      return res.status(404).json({ error: "Shortlist not found" });
    }

    // Lock the university in database and get updated user
    const updatedUser = await User.lockUniversity(req.user.id, shortlist_id);
    await Shortlist.lock(shortlist_id);

    // Delete any existing AI-generated tasks
    await Task.deleteAIGenerated(req.user.id);

    // Generate university-specific tasks
    const profile = req.user.profile_data || {};
    const tasks = generateUniversityTasks(shortlist, profile);

    const createdTasks = await Task.bulkCreate(req.user.id, tasks.map(task => ({
      ...task,
      university_id: shortlist_id
    })));

    res.json({
      message: "University locked successfully!",
      university: {
        id: shortlist.id,
        name: shortlist.uni_name,
        country: shortlist.country,
        category: shortlist.category
      },
      tasks_generated: createdTasks.length,
      next_steps: "Check your dashboard for personalized application tasks",
      user: {
        id: updatedUser.id,
        name: updatedUser.name,
        email: updatedUser.email,
        stage: updatedUser.stage,
        locked_university_id: updatedUser.locked_university_id,
        profile_data: updatedUser.profile_data
      }
    });

  } catch (err) {
    console.error("Lock university error:", err);
    res.status(500).json({ error: 'Server Error' });
  }
};

// @desc    UNLOCK University
// @route   POST /api/shortlist/unlock
const unlockUniversity = async (req, res) => {
  try {
    if (!req.user.locked_university_id) {
      return res.status(400).json({ error: "No university is currently locked" });
    }

    // Get locked university details for response
    const locked = await Shortlist.findById(req.user.locked_university_id);

    // Delete all AI-generated tasks
    const deletedTasks = await Task.deleteAIGenerated(req.user.id);

    // Unlock in database and get updated user
    const updatedUser = await User.unlockUniversity(req.user.id);
    await Shortlist.unlock(req.user.locked_university_id);

    res.json({
      warning: "All application tasks have been deleted",
      message: "You can now lock a different university",
      previous_choice: locked.uni_name,
      tasks_deleted: deletedTasks.length,
      user: {
        id: updatedUser.id,
        name: updatedUser.name,
        email: updatedUser.email,
        stage: updatedUser.stage,
        locked_university_id: updatedUser.locked_university_id,
        profile_data: updatedUser.profile_data
      }
    });

  } catch (err) {
    console.error("Unlock university error:", err);
    res.status(500).json({ error: 'Server Error' });
  }
};

module.exports = {
  addToShortlist,
  getShortlist,
  removeFromShortlist,
  lockUniversity,
  unlockUniversity
};