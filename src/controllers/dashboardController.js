const { pool } = require('../config/db');
const Task = require('../models/taskModel');

// Helper: Calculate comprehensive profile strength
const calculateProfileStrength = (profile) => {
  let score = 0;
  let details = {
    academics: "Weak",
    exams: "Not Started",
    sop: "Not Started",
    experience: "None"
  };

  // 1. Academic strength (0-4 points)
  if (profile.gpa) {
    const gpa = parseFloat(profile.gpa);
    const scale = profile.gpa_scale || 4.0;
    const percentage = (gpa / scale) * 100;

    if (percentage >= 85) {
      details.academics = "Strong";
      score += 4;
    } else if (percentage >= 70) {
      details.academics = "Average";
      score += 2;
    } else {
      details.academics = "Weak";
      score += 1;
    }
  }

  // 2. Exam readiness (0-4 points)
  let examScore = 0;
  if (profile.ielts_status === "completed") {
    const ieltsScore = parseFloat(profile.ielts_score) || 0;
    if (ieltsScore >= 7.0) examScore += 2;
    else if (ieltsScore >= 6.0) examScore += 1;
  }
  if (profile.toefl_status === "completed") {
    const toeflScore = parseFloat(profile.toefl_score) || 0;
    if (toeflScore >= 100) examScore += 2;
    else if (toeflScore >= 80) examScore += 1;
  }
  if (profile.gre_status === "completed") examScore += 1;
  if (profile.gmat_status === "completed") examScore += 1;

  if (examScore >= 3) {
    details.exams = "Strong";
    score += 4;
  } else if (examScore >= 1) {
    details.exams = "In Progress";
    score += 2;
  } else {
    details.exams = "Not Started";
    score += 0;
  }

  // 3. SOP status (0-2 points)
  if (profile.sop_status === "ready") {
    details.sop = "Ready";
    score += 2;
  } else if (profile.sop_status === "draft") {
    details.sop = "Draft";
    score += 1;
  } else {
    details.sop = "Not Started";
  }

  // 4. Experience (0-2 points)
  const workYears = parseInt(profile.work_experience_years) || 0;
  if (workYears >= 2 || profile.research_experience) {
    details.experience = "Strong";
    score += 2;
  } else if (workYears >= 1) {
    details.experience = "Some";
    score += 1;
  }

  // Calculate overall strength
  let overall = "Weak";
  if (score >= 10) overall = "Strong";
  else if (score >= 6) overall = "Average";

  return {
    overall,
    details,
    score,
    max_score: 12
  };
};

// Helper: Get stage information
const getStageInfo = (stage) => {
  const stages = {
    1: {
      name: "Building Profile",
      description: "Complete your onboarding to unlock AI features",
      next_action: "Fill in your academic background and study goals"
    },
    2: {
      name: "Discovering Universities",
      description: "Explore and shortlist universities that fit your profile",
      next_action: "Talk to AI Counsellor and shortlist universities"
    },
    3: {
      name: "Finalizing Universities",
      description: "Review your shortlist and make your final choice",
      next_action: "Lock your top choice university to proceed"
    },
    4: {
      name: "Preparing Applications",
      description: "Execute your application strategy step-by-step",
      next_action: "Complete tasks and prepare application documents"
    }
  };

  return stages[stage] || stages[1];
};

// Helper: Generate next steps based on stage and profile
const getNextSteps = (stage, profile, stats) => {
  const steps = {
    1: [
      { task: "Complete your profile", priority: "high", done: profile.onboarding_completed },
      { task: "Add exam scores", priority: "medium", done: false },
      { task: "Set target countries", priority: "high", done: !!profile.preferred_countries }
    ],
    2: [
      { task: "Chat with AI Counsellor", priority: "high", done: false },
      { task: "Explore university recommendations", priority: "high", done: stats.shortlisted > 0 },
      { task: "Shortlist 5-10 universities", priority: "medium", done: stats.shortlisted >= 5 }
    ],
    3: [
      { task: "Review fit analysis for each university", priority: "high", done: false },
      { task: "Compare universities side-by-side", priority: "medium", done: false },
      { task: "Lock your final choice", priority: "critical", done: stats.locked }
    ],
    4: [
      { task: "Draft Statement of Purpose (SOP)", priority: "critical", done: profile.sop_status === "ready" },
      { task: "Request Letters of Recommendation", priority: "critical", done: false },
      { task: "Prepare visa documents", priority: "high", done: false },
      { task: "Complete all pending tasks", priority: "high", done: stats.pending_tasks === 0 }
    ]
  };

  return steps[stage] || steps[1];
};

// @desc    Get Full Dashboard Stats
// @route   GET /api/dashboard
const getDashboardStats = async (req, res) => {
  try {
    const user = req.user;
    const profile = user.profile_data || {};

    // 1. Calculate Profile Strength
    const strength = calculateProfileStrength(profile);

    // 2. Get Stage Info
    const stageInfo = getStageInfo(user.stage);

    // 3. Get Counts
    const shortlistCount = await pool.query(
      'SELECT COUNT(*) FROM shortlists WHERE user_id = $1',
      [user.id]
    );

    const taskStats = await Task.getStats(user.id);

    // 4. Get locked university if exists
    let lockedUniversity = null;
    if (user.locked_university_id) {
      const uniResult = await pool.query(
        'SELECT * FROM shortlists WHERE id = $1',
        [user.locked_university_id]
      );
      lockedUniversity = uniResult.rows[0];
    }

    const stats = {
      shortlisted: parseInt(shortlistCount.rows[0].count),
      locked: !!user.locked_university_id,
      pending_tasks: parseInt(taskStats.pending),
      completed_tasks: parseInt(taskStats.completed),
      total_tasks: parseInt(taskStats.total),
      high_priority_tasks: parseInt(taskStats.high_priority)
    };

    // 5. Auto-generate tasks if needed based on profile gaps
    await autoGenerateTasks(user.id, profile, user.stage, stats);

    // 6. Get updated task stats after auto-generation
    const updatedTaskStats = await Task.getStats(user.id);

    res.json({
      profile_summary: {
        education: profile.current_education_level || "Not set",
        target_degree: profile.intended_degree || "Not set",
        intake: profile.target_intake_year ?
          `${profile.target_intake_season || 'Fall'} ${profile.target_intake_year}` : "Not set",
        countries: profile.preferred_countries || [],
        budget: profile.budget_range_min ?
          `$${profile.budget_range_min} - $${profile.budget_range_max}` : "Not set"
      },
      profile_strength: strength,
      current_stage: stageInfo,
      stats: {
        shortlisted: stats.shortlisted,
        pending_tasks: parseInt(updatedTaskStats.pending),
        completed_tasks: parseInt(updatedTaskStats.completed),
        total_tasks: parseInt(updatedTaskStats.total),
        completion_percentage: updatedTaskStats.total > 0 ?
          Math.round((updatedTaskStats.completed / updatedTaskStats.total) * 100) : 0
      },
      locked_university: lockedUniversity,
      next_steps: getNextSteps(user.stage, profile, stats)
    });

  } catch (err) {
    console.error("Dashboard error:", err);
    res.status(500).json({ error: 'Server Error' });
  }
};

// Helper: Auto-generate tasks based on profile gaps
const autoGenerateTasks = async (userId, profile, stage, stats) => {
  const tasksToCreate = [];

  // Only generate tasks if user has completed onboarding
  if (!profile.onboarding_completed) return;

  // Stage 2: Discovery tasks
  if (stage === 2 && stats.shortlisted === 0) {
    // Check if discovery tasks already exist
    const existingTasks = await pool.query(
      "SELECT * FROM tasks WHERE user_id = $1 AND category = 'discovery' AND ai_generated = true",
      [userId]
    );

    if (existingTasks.rows.length === 0) {
      tasksToCreate.push({
        title: "Explore university recommendations from AI Counsellor",
        category: "discovery",
        priority: "high",
        ai_generated: true
      });
    }
  }

  // Exam preparation tasks
  if (profile.ielts_status === "not-started" || !profile.ielts_status) {
    const hasIeltsTask = await pool.query(
      "SELECT * FROM tasks WHERE user_id = $1 AND title LIKE '%IELTS%' AND status = 'pending'",
      [userId]
    );
    if (hasIeltsTask.rows.length === 0) {
      tasksToCreate.push({
        title: "Register for IELTS exam",
        category: "exams",
        priority: "high",
        ai_generated: true
      });
    }
  }

  // SOP tasks
  if (profile.sop_status === "not-started" || !profile.sop_status) {
    const hasSopTask = await pool.query(
      "SELECT * FROM tasks WHERE user_id = $1 AND title LIKE '%SOP%' AND status = 'pending'",
      [userId]
    );
    if (hasSopTask.rows.length === 0) {
      tasksToCreate.push({
        title: "Start drafting Statement of Purpose (SOP)",
        category: "sop",
        priority: "medium",
        ai_generated: true
      });
    }
  }

  // Create tasks in bulk
  if (tasksToCreate.length > 0) {
    await Task.bulkCreate(userId, tasksToCreate);
  }
};

module.exports = { getDashboardStats };