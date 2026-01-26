const { pool } = require('../config/db');

const RecommendationCache = {
    // Save recommendations to cache
    save: async (userId, recommendations, profileHash) => {
        const result = await pool.query(
            `INSERT INTO user_recommendations (user_id, recommendations, profile_hash)
       VALUES ($1, $2, $3)
       RETURNING *`,
            [userId, JSON.stringify(recommendations), profileHash]
        );
        return result.rows[0];
    },

    // Get cached recommendations
    get: async (userId, profileHash) => {
        const result = await pool.query(
            `SELECT * FROM user_recommendations 
       WHERE user_id = $1 AND profile_hash = $2
       ORDER BY generated_at DESC 
       LIMIT 1`,
            [userId, profileHash]
        );
        return result.rows[0];
    },

    // Get latest recommendations (ignoring hash)
    getLatest: async (userId) => {
        const result = await pool.query(
            `SELECT * FROM user_recommendations 
       WHERE user_id = $1
       ORDER BY generated_at DESC 
       LIMIT 1`,
            [userId]
        );
        return result.rows[0];
    },

    // Check if cache is valid (less than 24 hours old)
    isValid: async (userId, profileHash) => {
        const cached = await RecommendationCache.get(userId, profileHash);

        if (!cached) return false;

        const cacheAge = Date.now() - new Date(cached.generated_at).getTime();
        const MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours

        return cacheAge < MAX_AGE;
    },

    // Invalidate cache for user (delete all cached recommendations)
    invalidate: async (userId) => {
        const result = await pool.query(
            'DELETE FROM user_recommendations WHERE user_id = $1 RETURNING *',
            [userId]
        );
        return result.rows;
    },

    // Clean old cache entries (older than 7 days)
    cleanOld: async () => {
        const result = await pool.query(
            `DELETE FROM user_recommendations 
       WHERE generated_at < NOW() - INTERVAL '7 days'
       RETURNING *`
        );
        return result.rows;
    }
};

module.exports = RecommendationCache;
