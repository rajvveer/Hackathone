const { pool } = require('../config/db');

const Conversation = {
    // Create a new conversation for a user
    create: async (userId) => {
        const result = await pool.query(
            'INSERT INTO conversations (user_id, messages) VALUES ($1, $2) RETURNING *',
            [userId, JSON.stringify([])]
        );
        return result.rows[0];
    },

    // Get or create conversation for user
    getOrCreate: async (userId) => {
        // Try to get existing conversation
        let result = await pool.query(
            'SELECT * FROM conversations WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1',
            [userId]
        );

        if (result.rows.length > 0) {
            return result.rows[0];
        }

        // Create new if doesn't exist
        return await Conversation.create(userId);
    },

    // Add message to conversation
    addMessage: async (conversationId, role, content) => {
        const result = await pool.query(
            `UPDATE conversations 
       SET messages = messages || $1::jsonb,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 
       RETURNING *`,
            [JSON.stringify({ role, content, timestamp: new Date().toISOString() }), conversationId]
        );
        return result.rows[0];
    },

    // Get conversation history
    getHistory: async (conversationId) => {
        const result = await pool.query(
            'SELECT messages FROM conversations WHERE id = $1',
            [conversationId]
        );
        return result.rows[0]?.messages || [];
    },

    // Clear conversation history
    clear: async (conversationId) => {
        const result = await pool.query(
            `UPDATE conversations 
       SET messages = '[]'::jsonb, 
           updated_at = CURRENT_TIMESTAMP 
       WHERE id = $1 
       RETURNING *`,
            [conversationId]
        );
        return result.rows[0];
    },

    // Delete conversation
    delete: async (conversationId, userId) => {
        const result = await pool.query(
            'DELETE FROM conversations WHERE id = $1 AND user_id = $2 RETURNING *',
            [conversationId, userId]
        );
        return result.rows[0];
    },

    // Get all conversations for user
    findAllByUser: async (userId) => {
        const result = await pool.query(
            'SELECT * FROM conversations WHERE user_id = $1 ORDER BY updated_at DESC',
            [userId]
        );
        return result.rows;
    }
};

module.exports = Conversation;
