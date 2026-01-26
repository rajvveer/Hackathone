const User = require('../models/userModel');

// Middleware to check if user has completed onboarding
const requireOnboarding = async (req, res, next) => {
    try {
        const user = req.user;

        if (!user) {
            return res.status(401).json({
                error: "Unauthorized",
                message: "Please log in to access this feature"
            });
        }

        const profile = user.profile_data || {};

        // Check if onboarding is completed
        if (!user.onboarding_completed && !profile.onboarding_completed) {
            return res.status(403).json({
                error: "Onboarding incomplete",
                message: "Please complete your profile to access this feature",
                redirect: "/onboarding"
            });
        }

        next();
    } catch (err) {
        console.error("Onboarding middleware error:", err);
        res.status(500).json({ error: "Server error" });
    }
};

// Middleware to check specific profile fields
const requireProfileFields = (requiredFields) => {
    return (req, res, next) => {
        try {
            const profile = req.user?.profile_data || {};
            const missing = [];

            for (const field of requiredFields) {
                if (!profile[field]) {
                    missing.push(field);
                }
            }

            if (missing.length > 0) {
                return res.status(400).json({
                    error: "Incomplete profile",
                    message: "Required profile fields are missing",
                    missing_fields: missing
                });
            }

            next();
        } catch (err) {
            console.error("Profile fields middleware error:", err);
            res.status(500).json({ error: "Server error" });
        }
    };
};

// Middleware to check if user is at a minimum stage
const requireStage = (minimumStage) => {
    return (req, res, next) => {
        try {
            const userStage = req.user?.stage || 1;

            if (userStage < minimumStage) {
                return res.status(403).json({
                    error: "Access denied",
                    message: `You must complete stage ${minimumStage} to access this feature`,
                    current_stage: userStage,
                    required_stage: minimumStage
                });
            }

            next();
        } catch (err) {
            console.error("Stage middleware error:", err);
            res.status(500).json({ error: "Server error" });
        }
    };
};

module.exports = {
    requireOnboarding,
    requireProfileFields,
    requireStage
};
