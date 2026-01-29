const { pool } = require('./src/config/db');
const Task = require('./src/models/taskModel');

const run = async () => {
    try {
        console.log("Connecting...");
        await pool.connect();

        const userId = 1; // Assuming default test user ID is 1

        // 1. Create a task with ai_generated = true
        console.log("Creating test AI task...");
        const task = await Task.create(userId, "Test AI Task", {
            ai_generated: true,
            priority: 'high'
        });
        console.log("Created task:", task.id, "AI Generated:", task.ai_generated);

        // 2. Verify it exists
        const tasksBefore = await Task.findAllByUser(userId);
        const aiTaskBefore = tasksBefore.find(t => t.id === task.id);
        if (!aiTaskBefore) {
            console.error("❌ Task creation failed - not found in list");
            process.exit(1);
        }
        console.log("✅ Task exists before deletion");

        // 3. Delete AI generated tasks
        console.log("Deleting AI generated tasks...");
        const deleted = await Task.deleteAIGenerated(userId);
        console.log("Deleted count:", deleted.length);

        // 4. Verify it is gone
        const tasksAfter = await Task.findAllByUser(userId);
        const aiTaskAfter = tasksAfter.find(t => t.id === task.id);

        if (aiTaskAfter) {
            console.error("❌ Task STILL EXISTS after deletion! Bug reproduced.");
            console.log("Task details:", aiTaskAfter);
        } else {
            console.log("✅ Task successfully deleted. Backend logic is correct.");
        }

    } catch (err) {
        console.error("Error:", err);
    } finally {
        pool.end();
    }
};

run();
