const { pool } = require('../config/db');
const User = require('../models/userModel');
const RecommendationCache = require('../models/recommendationCacheModel');
const Shortlist = require('../models/shortlistModel');

// @desc    Get User Profile
// @route   GET /api/user/profile
const getProfile = async (req, res) => {
  try {
    res.json({
      id: req.user.id,
      name: req.user.name,
      email: req.user.email,
      stage: req.user.stage,
      profile_data: req.user.profile_data || {},
      onboarding_completed: req.user.onboarding_completed,
      locked_university_id: req.user.locked_university_id,
      locked_at: req.user.locked_at
    });
  } catch (err) {
    console.error("Get profile error:", err);
    res.status(500).json({ error: 'Server Error' });
  }
};

// Validation helper function
const validateProfileData = (data) => {
  const errors = [];

  // GPA validation
  if (data.gpa && data.gpa_scale) {
    const gpa = parseFloat(data.gpa);
    const scale = parseFloat(data.gpa_scale);

    if (gpa > scale) {
      errors.push("GPA cannot exceed GPA scale");
    }
    if (gpa < 0 || scale < 0) {
      errors.push("GPA and scale must be positive numbers");
    }
  }

  // Budget validation
  if (data.budget_range_min && data.budget_range_max) {
    const min = parseFloat(data.budget_range_min);
    const max = parseFloat(data.budget_range_max);

    if (min > max) {
      errors.push("Minimum budget cannot exceed maximum budget");
    }
    if (min < 0 || max < 0) {
      errors.push("Budget values must be positive");
    }
  }

  // IELTS score validation
  if (data.ielts_score) {
    const score = parseFloat(data.ielts_score);
    if (score < 0 || score > 9) {
      errors.push("IELTS score must be between 0 and 9");
    }
  }

  // TOEFL score validation
  if (data.toefl_score) {
    const score = parseFloat(data.toefl_score);
    if (score < 0 || score > 120) {
      errors.push("TOEFL score must be between 0 and 120");
    }
  }

  // GRE score validation
  if (data.gre_score) {
    const score = parseFloat(data.gre_score);
    if (score < 0 || score > 340) {
      errors.push("GRE score must be between 0 and 340");
    }
  }

  // GMAT score validation
  if (data.gmat_score) {
    const score = parseFloat(data.gmat_score);
    if (score < 0 || score > 800) {
      errors.push("GMAT score must be between 0 and 800");
    }
  }

  // Preferred countries validation
  if (data.preferred_countries && !Array.isArray(data.preferred_countries)) {
    errors.push("Preferred countries must be an array");
  }

  return {
    valid: errors.length === 0,
    errors
  };
};

// @desc    Update Profile (Comprehensive Onboarding)
// @route   PUT /api/user/profile
const updateProfile = async (req, res) => {
  try {
    const profileData = {
      // Academic Background
      current_education_level: req.body.current_education_level,
      current_degree: req.body.current_degree,
      current_major: req.body.current_major,
      graduation_year: req.body.graduation_year,
      gpa: req.body.gpa,
      gpa_scale: req.body.gpa_scale || 4.0,

      // Study Goals
      intended_degree: req.body.intended_degree,
      field_of_study: req.body.field_of_study,
      target_intake_year: req.body.target_intake_year,
      target_intake_season: req.body.target_intake_season,
      preferred_countries: req.body.preferred_countries,

      // Budget
      budget_range_min: req.body.budget_range_min,
      budget_range_max: req.body.budget_range_max,
      funding_plan: req.body.funding_plan,

      // Exams
      ielts_status: req.body.ielts_status,
      ielts_score: req.body.ielts_score,
      toefl_status: req.body.toefl_status,
      toefl_score: req.body.toefl_score,
      gre_status: req.body.gre_status,
      gre_score: req.body.gre_score,
      gmat_status: req.body.gmat_status,
      gmat_score: req.body.gmat_score,

      // SOP
      sop_status: req.body.sop_status,

      // Additional fields
      work_experience_years: req.body.work_experience_years,
      research_experience: req.body.research_experience,

      // Completion tracking
      onboarding_completed: req.body.onboarding_completed || false,
      onboarding_mode: req.body.onboarding_mode || 'manual'
    };

    // Remove undefined fields
    Object.keys(profileData).forEach(key => {
      if (profileData[key] === undefined) {
        delete profileData[key];
      }
    });

    // Validate input
    const validation = validateProfileData(profileData);
    if (!validation.valid) {
      console.log("Profile Validation Failed:", JSON.stringify(validation.errors, null, 2));
      console.log("Received Data:", JSON.stringify(profileData, null, 2));
      return res.status(400).json({
        error: "Validation failed",
        errors: validation.errors
      });
    }

    // Detect changed fields
    const oldProfile = req.user.profile_data || {};
    const changedFields = [];
    const criticalFields = ['gpa', 'ielts_score', 'toefl_score', 'gre_score', 'budget_range_max', 'preferred_countries'];

    for (const field of criticalFields) {
      if (oldProfile[field] !== profileData[field]) {
        changedFields.push(field);
      }
    }

    // Update profile
    const updatedUser = await User.updateProfile(req.user.id, profileData);

    // Get shortlists count for response
    let shortlists = [];

    // If critical fields changed, invalidate recommendation cache
    if (changedFields.length > 0) {
      await RecommendationCache.invalidate(req.user.id);

      // Recalculate fit for existing shortlists
      shortlists = await Shortlist.findAllByUser(req.user.id);
      // Note: Actual recalculation would require AI call, skipping for now
    }

    res.json({
      user: {
        id: updatedUser.id,
        name: updatedUser.name,
        email: updatedUser.email,
        stage: updatedUser.stage,
        profile_data: updatedUser.profile_data,
        onboarding_completed: updatedUser.onboarding_completed
      },
      changes: {
        fields_updated: Object.keys(profileData).length,
        critical_fields_changed: changedFields,
        recommendations_invalidated: changedFields.length > 0,
        shortlist_count: shortlists?.length || 0
      },
      message: updatedUser.onboarding_completed ? "Profile updated successfully" : "Profile saved. Complete onboarding to unlock all features."
    });

  } catch (err) {
    console.error("Update profile error:", err);
    res.status(500).json({ error: 'Server Error' });
  }
};

// @desc    Delete User Account
// @route   DELETE /api/user/account
const deleteAccount = async (req, res) => {
  const userId = req.user.id;

  try {
    // Delete all user data in order (respecting foreign key constraints)
    await pool.query('DELETE FROM tasks WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM shortlists WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM conversations WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM user_recommendations WHERE user_id = $1', [userId]);

    // Finally delete the user
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);

    res.json({
      message: "Account deleted successfully",
      success: true
    });
  } catch (err) {
    console.error("Delete account error:", err);
    res.status(500).json({ error: 'Failed to delete account' });
  }
};

module.exports = { getProfile, updateProfile, deleteAccount };