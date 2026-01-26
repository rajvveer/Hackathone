const { pool } = require('../config/db');

/**
 * Stage Service - Centralized stage management logic
 * Stages:
 * 1 = ONBOARDING - Building profile
 * 2 = DISCOVERY - Exploring universities
 * 3 = SHORTLIST - Finalizing choices
 * 4 = APPLICATION - Preparing applications
 */

// Get user's current stage based on profile and actions
const getUserStage = async (user) => {
    const profile = user.profile_data || {};

    // Stage 1: ONBOARDING - Incomplete profile
    if (!user.onboarding_completed || !profile.onboarding_completed) {
        return {
            stage: 1,
            name: "ONBOARDING",
            description: "Complete your profile to unlock AI features",
            canAccess: {
                ai: false,
                recommendations: false,
                shortlist: false,
                application: false
            }
        };
    }

    // Stage 4: APPLICATION - University locked
    if (user.locked_university_id) {
        return {
            stage: 4,
            name: "APPLICATION",
            description: "Preparing applications for locked university",
            canAccess: {
                ai: true,
                recommendations: true,
                shortlist: true,
                application: true
            },
            locked: true
        };
    }

    // Check if user has shortlists
    const shortlistCount = await pool.query(
        'SELECT COUNT(*) FROM shortlists WHERE user_id = $1',
        [user.id]
    );

    const hasShortlists = parseInt(shortlistCount.rows[0].count) > 0;

    // Stage 3: SHORTLIST - Has shortlisted universities
    if (hasShortlists) {
        return {
            stage: 3,
            name: "SHORTLIST",
            description: "Review shortlist and lock your final choice",
            canAccess: {
                ai: true,
                recommendations: true,
                shortlist: true,
                application: false
            }
        };
    }

    // Stage 2: DISCOVERY - Profile complete, exploring universities
    return {
        stage: 2,
        name: "DISCOVERY",
        description: "Explore and shortlist universities",
        canAccess: {
            ai: true,
            recommendations: true,
            shortlist: true,
            application: false
        }
    };
};

// Determine next stage and required actions
const getNextStage = async (user) => {
    const currentStageInfo = await getUserStage(user);
    const profile = user.profile_data || {};

    const nextActions = {
        1: {
            nextStage: "DISCOVERY",
            requiredActions: [
                "Complete your academic background",
                "Add target universities",
                "Set budget and preferences"
            ],
            blockingIssues: getProfileGaps(profile)
        },
        2: {
            nextStage: "SHORTLIST",
            requiredActions: [
                "Talk to AI Counsellor for recommendations",
                "Shortlist at least 5 universities",
                "Review Dream/Target/Safe categories"
            ],
            blockingIssues: []
        },
        3: {
            nextStage: "APPLICATION",
            requiredActions: [
                "Compare shortlisted universities",
                "Review fit analysis and risks",
                "Lock your top choice university"
            ],
            blockingIssues: []
        },
        4: {
            nextStage: "COMPLETE",
            requiredActions: [
                "Complete all application tasks",
                "Prepare required documents",
                "Submit applications before deadline"
            ],
            blockingIssues: []
        }
    };

    return {
        current: currentStageInfo,
        next: nextActions[currentStageInfo.stage]
    };
};

// Get profile gaps (what's missing)
const getProfileGaps = (profile) => {
    const gaps = [];

    if (!profile.gpa) gaps.push("GPA/grades");
    if (!profile.preferred_countries || profile.preferred_countries.length === 0) {
        gaps.push("Target countries");
    }
    if (!profile.field_of_study) gaps.push("Field of study");
    if (!profile.intended_degree) gaps.push("Target degree");
    if (!profile.budget_range_min || !profile.budget_range_max) gaps.push("Budget");

    // Exam gaps
    const hasEnglishTest = profile.ielts_status === "completed" || profile.toefl_status === "completed";
    if (!hasEnglishTest) gaps.push("English proficiency test (IELTS/TOEFL)");

    return gaps;
};

// Check if user can access a specific feature
const canAccessFeature = async (user, feature) => {
    const stageInfo = await getUserStage(user);
    return stageInfo.canAccess[feature] || false;
};

// Update user's stage in database
const updateUserStage = async (userId, newStage) => {
    const result = await pool.query(
        'UPDATE users SET stage = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
        [newStage, userId]
    );
    return result.rows[0];
};

// Get stage-specific recommendations
const getStageRecommendations = async (user) => {
    const stageInfo = await getUserStage(user);

    const recommendations = {
        1: [
            { type: "profile", message: "Add your GPA and academic background" },
            { type: "profile", message: "Set your budget range" },
            { type: "profile", message: "Choose target countries" }
        ],
        2: [
            { type: "ai", message: "Chat with AI Counsellor for personalized recommendations" },
            { type: "search", message: "Explore university recommendations" },
            { type: "action", message: "Shortlist 5-10 universities" }
        ],
        3: [
            { type: "review", message: "Compare shortlisted universities" },
            { type: "analysis", message: "Review fit scores and acceptance chances" },
            { type: "decision", message: "Lock your top choice to proceed" }
        ],
        4: [
            { type: "tasks", message: "Complete high-priority tasks" },
            { type: "documents", message: "Prepare required application documents" },
            { type: "deadlines", message: "Track application deadlines" }
        ]
    };

    return recommendations[stageInfo.stage] || [];
};

module.exports = {
    getUserStage,
    getNextStage,
    getProfileGaps,
    canAccessFeature,
    updateUserStage,
    getStageRecommendations
};
