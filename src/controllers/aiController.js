const Groq = require("groq-sdk");
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const { pool } = require('../config/db');
const Conversation = require('../models/conversationModel');
const Shortlist = require('../models/shortlistModel');
const Task = require('../models/taskModel');
const { generateRecommendations } = require('../services/aiService');

// @desc    Chat with AI Counsellor (with function calling)
// @route   POST /api/ai/chat
const chatWithCounsellor = async (req, res) => {
  const { message, conversation_id } = req.body;
  const user = req.user;

  try {
    // Get or create conversation
    let conversation;
    if (conversation_id) {
      conversation = await pool.query(
        'SELECT * FROM conversations WHERE id = $1 AND user_id = $2',
        [conversation_id, user.id]
      );
      conversation = conversation.rows[0];
    }

    if (!conversation) {
      conversation = await Conversation.getOrCreate(user.id);
    }

    // Build profile context
    const profile = user.profile_data || {};
    const profileContext = `
      User Profile:
      - Name: ${user.name}
      - Current Education: ${profile.current_education_level || "Not set"}
      - Target Degree: ${profile.intended_degree || "Not set"}
      - Field of Study: ${profile.field_of_study || "Not set"}
      - GPA: ${profile.gpa || "Not set"}${profile.gpa_scale ? `/${profile.gpa_scale}` : ''}
      - Budget: ${profile.budget_range_min && profile.budget_range_max ?
        `$${profile.budget_range_min}-${profile.budget_range_max}/year` : "Not set"}
      - Countries: ${profile.preferred_countries?.join(", ") || "Not set"}
      - Target Intake: ${profile.target_intake_season || 'Fall'} ${profile.target_intake_year || 'Not set'}
      - Current Stage: ${user.stage} (1=Profile, 2=Discovery, 3=Shortlist, 4=Locked)
      - IELTS: ${profile.ielts_status || "not started"}${profile.ielts_score ? ` (Score: ${profile.ielts_score})` : ''}
      - TOEFL: ${profile.toefl_status || "not started"}${profile.toefl_score ? ` (Score: ${profile.toefl_score})` : ''}
      - GRE: ${profile.gre_status || "not started"}
      - SOP Status: ${profile.sop_status || "not started"}
    `;

    // Define available functions for AI
    const tools = [
      {
        type: "function",
        function: {
          name: "shortlist_university",
          description: "Add a university to the user's shortlist with category (Dream/Target/Safe)",
          parameters: {
            type: "object",
            properties: {
              university_name: { type: "string", description: "Full name of the university" },
              country: { type: "string", description: "Country where university is located" },
              category: {
                type: "string",
                enum: ["Dream", "Target", "Safe"],
                description: "Match category based on user's profile"
              },
              why_fits: { type: "string", description: "2-3 sentence explanation of why this fits the user" },
              key_risks: {
                type: "array",
                items: { type: "string" },
                description: "List of potential risks or challenges"
              },
              acceptance_chance: {
                type: "string",
                enum: ["Low", "Medium", "High"],
                description: "Realistic acceptance chance for this user"
              }
            },
            required: ["university_name", "country", "category"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "add_task",
          description: "Add a task to the user's to-do list",
          parameters: {
            type: "object",
            properties: {
              title: { type: "string", description: "Task title" },
              description: { type: "string", description: "Detailed task description" },
              category: {
                type: "string",
                enum: ["exams", "sop", "lor", "documents", "visa", "research", "profile", "other"],
                description: "Task category (use 'profile' for profile-related tasks like updating GPA)"
              },
              priority: {
                type: "string",
                enum: ["high", "medium", "low"],
                description: "Task priority level"
              }
            },
            required: ["title"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "get_university_recommendations",
          description: "Generate fresh personalized university recommendations based on current profile",
          parameters: {
            type: "object",
            properties: {
              reason: {
                type: "string",
                description: "Context/reason for generating recommendations (optional)"
              }
            }
          }
        }
      }
    ];

    // Get conversation history
    const history = conversation.messages || [];
    const recentHistory = history.slice(-20); // Last 20 messages

    // Build messages array
    const messages = [
      {
        role: "system",
        content: `You are an expert Study Abroad Counsellor with the ability to take actions on behalf of the user.
        
        Your role:
        - Provide realistic, honest advice about university admissions
        - Be strict when the user's profile doesn't match their aspirations
        - Use data to support your recommendations
        - Take actions when appropriate (shortlist universities, add tasks)
        
        CRITICAL - TOOL USAGE RULES:
        - You have access to tools/functions. The system will automatically handle tool calls for you.
        - NEVER write function calls as text like "<function=..." or "update_profile(...)". This will cause errors.
        - Simply describe what action you want to take and the system will invoke the appropriate tool.
        - If you want to update a profile field, use the update_profile tool.
        - If you want to mark a task as done, use the set_task_status tool.
        
        Important guidelines:
        - If budget is low (<$20k/year), suggest affordable countries like Germany, Norway, or scholarships
        - If GPA is below 3.0/4.0 (75%), be cautious about top universities
        - Always explain WHY a university fits or doesn't fit
        - Highlight risks honestly (e.g., "Your GPA is below their average")
        - Encourage preparation (exams, SOP) before applications
        
        ${profileContext}
        
        You can use these functions:
        1. shortlist_university - When you recommend a specific university
        2. add_task - CREATE NEW TASKS ONLY. Do not use for existing ones.
        3. set_task_status - MARK TASKS DONE. Use when user says "mark X done" or "complete X".
        4. get_university_recommendations - To generate fresh recommendations
        
        VALUE NORMALIZATION:
        - If user provides a number with 'k' suffix (e.g., '85k', '50k'), ALWAYS convert it to thousands (e.g., '85000', '50000') before calling tools.
        
        Be conversational but professional. Use the user's name occasionally.`
      },
      ...recentHistory.map(msg => ({
        role: msg.role,
        content: msg.content
      })),
      { role: "user", content: message }
    ];

    // Call Groq with function calling
    const completion = await groq.chat.completions.create({
      messages,
      model: "llama-3.1-8b-instant",
      tools,
      tool_choice: "auto",
      temperature: 0.7
    });

    const responseMessage = completion.choices[0].message;

    // Save user message to conversation
    await Conversation.addMessage(conversation.id, "user", message);

    // Check if AI wants to call functions
    const actions = [];
    if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
      for (const toolCall of responseMessage.tool_calls) {
        const functionName = toolCall.function.name;
        const functionArgs = JSON.parse(toolCall.function.arguments);

        let result;

        switch (functionName) {
          case "shortlist_university":
            result = await executeShortlist(user.id, functionArgs);
            actions.push({
              action: "shortlist_added",
              university: functionArgs.university_name,
              category: functionArgs.category,
              result
            });
            break;

          case "add_task":
            result = await executeAddTask(user.id, functionArgs);
            actions.push({
              action: "task_added",
              task: functionArgs.title,
              result
            });
            break;

          case "get_university_recommendations":
            result = await executeGetRecommendations(user);
            actions.push({
              action: "recommendations_generated",
              result
            });
            break;

          case "set_task_status":
            result = await executeUpdateTask(user.id, functionArgs, user.tasks || []);
            actions.push({
              action: "task_updated",
              task: functionArgs.task_keyword,
              status: functionArgs.status,
              result
            });
            break;
        }
      }
    }

    // Prepare response
    const aiReply = responseMessage.content || "I've taken the following actions for you.";

    // Save AI response to conversation
    await Conversation.addMessage(conversation.id, "assistant", aiReply);

    res.json({
      reply: aiReply,
      actions,
      conversation_id: conversation.id,
      has_actions: actions.length > 0
    });

  } catch (err) {
    console.error("AI Chat error:", err);
    res.status(500).json({
      error: 'AI Error',
      message: err.message
    });
  }
};

// Helper: Execute shortlist action
const executeShortlist = async (userId, args) => {
  try {
    // Check if already shortlisted
    const existing = await Shortlist.findByUniName(userId, args.university_name);
    if (existing) {
      return {
        success: true,
        message: `${args.university_name} is already in your ${existing.category} list`,
        shortlist: existing,
        isDuplicate: true
      };
    }

    const newShortlist = await Shortlist.add(userId, {
      uni_name: args.university_name,
      country: args.country,
      category: args.category,
      why_fits: args.why_fits,
      key_risks: args.key_risks,
      acceptance_chance: args.acceptance_chance,
      data: {
        added_by: 'ai_counsellor',
        timestamp: new Date().toISOString()
      }
    });

    return {
      success: true,
      message: `Added ${args.university_name} to your ${args.category} list`,
      shortlist: newShortlist
    };
  } catch (err) {
    console.error("Shortlist execution error:", err);
    return {
      success: false,
      message: "Failed to add university to shortlist"
    };
  }
};

// Helper: Execute add task action
const executeAddTask = async (userId, args) => {
  try {
    const newTask = await Task.create(userId, args.title, {
      description: args.description,
      category: args.category,
      priority: args.priority || 'medium',
      ai_generated: true
    });

    return {
      success: true,
      message: `Added task: ${args.title}`,
      task: newTask
    };
  } catch (err) {
    console.error("Task execution error:", err);
    return {
      success: false,
      message: "Failed to add task"
    };
  }
};

// Helper: Execute update task action
const executeUpdateTask = async (userId, args, existingTasks) => {
  try {
    console.log("Execute update task called with:", args);
    const { task_keyword, status } = args;
    const { pool } = require('../config/db');

    // 1. Find the task matching the keyword
    // Search in existingTasks context first, or query DB if needed (butcontext is faster)
    // We'll trust the AI's ability to pick a keyword, but let's do a DB fuzzy search to be safe
    // actually, let's look up all user tasks to be sure
    const tasksResult = await pool.query('SELECT * FROM tasks WHERE user_id = $1', [userId]);
    const tasks = tasksResult.rows;

    const matchedTask = tasks.find(t =>
      t.title.toLowerCase().includes(task_keyword.toLowerCase())
    );

    if (!matchedTask) {
      return {
        success: false,
        message: `Could not find a task matching "${task_keyword}"`
      };
    }

    // 2. Determine new status
    let newStatus = matchedTask.status;
    let completedAt = matchedTask.completed_at;

    if (status === 'completed') {
      newStatus = 'completed';
      completedAt = new Date().toISOString();
    } else if (status === 'pending') {
      newStatus = 'pending';
      completedAt = null;
    }

    // 3. Update task
    const updatedTask = await pool.query(
      'UPDATE tasks SET status = $1, completed_at = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3 RETURNING *',
      [newStatus, completedAt, matchedTask.id]
    );

    return {
      success: true,
      message: `Marked task "${matchedTask.title}" as ${newStatus}`,
      task: updatedTask.rows[0]
    };

  } catch (err) {
    console.error("Update task execution error:", err);
    return {
      success: false,
      message: `Failed to update task: ${err.message}`
    };
  }
};

// Helper: Execute get recommendations action
const executeGetRecommendations = async (user) => {
  try {
    // Fetch fresh profile data from database to ensure we use latest data
    const { pool } = require('../config/db');
    const freshUserResult = await pool.query(
      'SELECT profile_data FROM users WHERE id = $1',
      [user.id]
    );
    const freshProfile = freshUserResult.rows[0]?.profile_data || user.profile_data;

    const recommendations = await generateRecommendations(freshProfile);

    return {
      success: true,
      recommendations,
      count: recommendations?.length || 0
    };
  } catch (err) {
    console.error("Recommendations execution error:", err);
    return {
      success: false,
      message: "Failed to generate recommendations"
    };
  }
};

// Helper: Execute lock university action
const executeLockUniversity = async (userId, args, shortlist) => {
  try {
    // Find the university in the shortlist (case-insensitive partial match)
    const targetName = args.university_name.toLowerCase();
    const matchedUni = shortlist.find(s =>
      s.uni_name.toLowerCase().includes(targetName) ||
      targetName.includes(s.uni_name.toLowerCase())
    );

    if (!matchedUni) {
      return {
        success: false,
        message: `"${args.university_name}" is not in your shortlist. Please shortlist it first.`
      };
    }

    // Lock the university
    await Shortlist.lock(userId, matchedUni.id);

    return {
      success: true,
      message: `Locked ${matchedUni.uni_name} as your primary university!`,
      university: matchedUni
    };
  } catch (err) {
    console.error("Lock university error:", err);
    return {
      success: false,
      message: "Failed to lock university"
    };
  }
};

// Helper: Execute profile update action
const executeUpdateProfile = async (userId, currentProfile, args) => {
  try {
    const { field, value } = args;
    const updatedProfile = { ...currentProfile };

    // Handle different field types
    switch (field) {
      // Array fields (comma-separated)
      case 'preferred_countries':
        updatedProfile[field] = value.split(',').map(v => v.trim());
        break;

      // Numeric fields
      case 'gpa':
      case 'gpa_scale':
      case 'ielts_score':
      case 'toefl_score':
      case 'gre_score':
      case 'gmat_score':
      case 'budget_range_min':
      case 'budget_range_max':
      case 'target_intake_year':
      case 'work_experience_years':
        updatedProfile[field] = parseFloat(value) || value;
        break;

      // Status fields
      case 'ielts_status':
      case 'toefl_status':
      case 'gre_status':
      case 'gmat_status':
      case 'sop_status':
        // Normalize status values
        const normalizedStatus = value.toLowerCase().replace(/\s+/g, '-');
        if (['not-started', 'in-progress', 'completed', 'ready', 'draft'].includes(normalizedStatus)) {
          updatedProfile[field] = normalizedStatus;
        } else {
          updatedProfile[field] = value;
        }
        break;

      // String fields
      default:
        updatedProfile[field] = value;
        break;
    }

    // Keep onboarding completed status
    updatedProfile.onboarding_completed = currentProfile.onboarding_completed || true;

    // Update in database
    const User = require('../models/userModel');
    await User.updateProfile(userId, updatedProfile);

    // Format field name for display
    const displayField = field.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

    return {
      success: true,
      message: `Updated ${displayField} to "${value}"`,
      updatedProfile // Return the updated profile so caller can refresh user data
    };
  } catch (err) {
    console.error("Update profile error:", err);
    return {
      success: false,
      message: "Failed to update profile"
    };
  }
};


// @desc    Get conversation history
// @route   GET /api/ai/conversation/:id
const getConversation = async (req, res) => {
  try {
    const { id } = req.params;
    const history = await Conversation.getHistory(id);

    res.json({
      conversation_id: id,
      messages: history
    });
  } catch (err) {
    console.error("Get conversation error:", err);
    res.status(500).json({ error: 'Server Error' });
  }
};

// @desc    Clear conversation history
// @route   DELETE /api/ai/conversation/:id
const clearConversation = async (req, res) => {
  try {
    const { id } = req.params;
    await Conversation.clear(id);

    res.json({ message: "Conversation cleared successfully" });
  } catch (err) {
    console.error("Clear conversation error:", err);
    res.status(500).json({ error: 'Server Error' });
  }
};

// @desc    Stream chat with AI Counsellor (SSE) - WITH TOOL EXECUTION
// @route   POST /api/ai/chat/stream
const streamChatWithCounsellor = async (req, res) => {
  const { message, conversation_id } = req.body;
  // FORCE FRESH USER DATA FETCH
  // Middleware req.user might be stale if multiple requests happen quickly
  const { pool } = require('../config/db');
  let user;
  try {
    const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    user = userResult.rows[0];
  } catch (err) {
    user = req.user; // Fallback
  }

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  try {
    // PARALLEL CONTEXT FETCHING for performance
    const [conversation, shortlistResult, tasksResult] = await Promise.all([
      Conversation.getOrCreate(user.id),
      Shortlist.findAllByUser(user.id),
      Task.findAllByUser(user.id)
    ]);

    // Process shortlist
    const shortlist = shortlistResult || [];
    const lockedUni = shortlist.find(s => s.id === user.locked_university_id);

    // Process tasks
    const tasks = tasksResult || [];
    user.tasks = tasks; // Attach tasks to user object for tools to use
    const completedTasks = tasks.filter(t => t.status === 'completed').length;
    const totalTasks = tasks.length;
    const taskProgress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
    const pendingHighPriority = tasks.filter(t => t.status === 'pending' && t.priority === 'high');

    // Build shortlist context
    const shortlistContext = shortlist.length > 0
      ? `\n      Shortlisted Universities:\n      ${shortlist.map(s => `- ${s.uni_name} (${s.country}) - ${s.category}${s.id === user.locked_university_id ? ' [LOCKED]' : ''}`).join('\n      ')}`
      : '\n      No universities shortlisted yet.';

    // Build task progress context
    const taskContext = totalTasks > 0
      ? `\n      Task Progress: ${completedTasks}/${totalTasks} tasks completed (${taskProgress}%)${taskProgress === 100
        ? ' - ALL TASKS COMPLETE! User is ready to submit application.'
        : `\n      Pending Tasks:\n      ${tasks.filter(t => t.status === 'pending').map(t => `- ${t.title} (${t.priority})`).join('\n      ')}`
      }`
      : '\n      No tasks assigned yet.';

    // Build profile context
    const profile = user.profile_data || {};
    const profileContext = `
      User Profile:
      - Name: ${user.name}
      - Current Education: ${profile.current_education_level || "Not set"}
      - Target Degree: ${profile.intended_degree || "Not set"}
      - Field of Study: ${profile.field_of_study || "Not set"}
      - GPA: ${profile.gpa || "Not set"}${profile.gpa_scale ? `/${profile.gpa_scale}` : ''}
      - Budget: ${profile.budget_range_min && profile.budget_range_max ?
        `$${profile.budget_range_min}-${profile.budget_range_max}/year` : "Not set"}
      - Funding: ${profile.funding_plan || "Not set"}
      - Countries: ${profile.preferred_countries?.join(", ") || "Not set"}
      - Target Intake: ${profile.target_intake_season || 'Fall'} ${profile.target_intake_year || 'Not set'}
      - Current Stage: ${user.stage} (1=Profile, 2=Discovery, 3=Shortlist, 4=Locked)
      - IELTS: ${profile.ielts_status || "not started"}${profile.ielts_score ? ` (Score: ${profile.ielts_score})` : ''}
      - GRE: ${profile.gre_status || "not started"}${profile.gre_score ? ` (Score: ${profile.gre_score})` : ''}
      - SOP Status: ${profile.sop_status || "not started"}
      - Locked University: ${lockedUni ? lockedUni.uni_name : 'None'}
      ${shortlistContext}
      ${taskContext}
    `;

    // Define tools (same as chatWithCounsellor)
    const tools = [
      {
        type: "function",
        function: {
          name: "shortlist_university",
          description: "Add a university to the user's shortlist with category (Dream/Target/Safe). Use this when the user asks you to shortlist or add a university.",
          parameters: {
            type: "object",
            properties: {
              university_name: { type: "string", description: "Full name of the university" },
              country: { type: "string", description: "Country where university is located" },
              category: {
                type: "string",
                enum: ["Dream", "Target", "Safe"],
                description: "Match category based on user's profile"
              },
              why_fits: { type: "string", description: "2-3 sentence explanation of why this fits the user" },
              acceptance_chance: {
                type: "string",
                enum: ["Low", "Medium", "High"],
                description: "Realistic acceptance chance for this user"
              }
            },
            required: ["university_name", "country", "category"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "add_task",
          description: "CREATE A NEW TASK. Do NOT use this if the user wants to mark an existing task as done (use set_task_status instead).",
          parameters: {
            type: "object",
            properties: {
              title: { type: "string", description: "Task title - clear and actionable" },
              description: { type: "string", description: "Detailed task description" },
              category: {
                type: "string",
                enum: ["exams", "sop", "lor", "documents", "visa", "research", "profile", "other"],
                description: "Task category"
              },
              priority: {
                type: "string",
                enum: ["high", "medium", "low"],
                description: "Task priority level"
              }
            },
            required: ["title"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "get_university_recommendations",
          description: "Generate fresh personalized university recommendations based on current profile",
          parameters: {
            type: "object",
            properties: {}
          }
        }
      },
      {
        type: "function",
        function: {
          name: "lock_university",
          description: "Lock a shortlisted university as the user's primary choice. This unlocks application guidance. Only use on universities already in the shortlist.",
          parameters: {
            type: "object",
            properties: {
              university_name: { type: "string", description: "Name of the university to lock (must be in shortlist)" }
            },
            required: ["university_name"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "update_profile",
          description: "Update the user's profile information. Use this when user asks to update, change, or set any profile field like GPA, IELTS score, target countries, budget, etc.",
          parameters: {
            type: "object",
            properties: {
              field: {
                type: "string",
                enum: [
                  "gpa", "gpa_scale",
                  "ielts_status", "ielts_score",
                  "toefl_status", "toefl_score",
                  "gre_status", "gre_score",
                  "gmat_status", "gmat_score",
                  "sop_status",
                  "preferred_countries",
                  "budget_range_min", "budget_range_max",
                  "target_intake_year", "target_intake_season",
                  "intended_degree", "field_of_study",
                  "current_education_level", "work_experience_years",
                  "funding_plan"
                ],
                description: "The profile field to update"
              },
              value: {
                type: "string",
                description: "The new value for the field. CONVERT 'k' SUFFIXES TO ZEROS (e.g., '85k' -> '85000'). For arrays, use comma-separated values. For status: not-started, in-progress, completed."
              }
            },
            required: ["field", "value"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "set_task_status",
          description: "Update the status of an existing task. REQUIRED for 'mark done', 'complete', 'finish'.",
          parameters: {
            type: "object",
            properties: {
              task_keyword: { type: "string", description: "A unique keyword or phrase from the task title to identify it" },
              status: {
                type: "string",
                enum: ["completed", "pending"],
                description: "The new status to set"
              }
            },
            required: ["task_keyword", "status"]
          }
        }
      }
    ];

    // Get conversation history
    const history = conversation.messages || [];
    const recentHistory = history.slice(-20);

    // Build messages array
    const messages = [
      {
        role: "system",
        content: `You are an expert Study Abroad Counsellor with the ability to take actions on behalf of the user.
        
        Your role:
        - Provide realistic, honest advice about university admissions
        - TAKE ACTIONS when the user asks you to (add tasks, shortlist universities, lock universities, update profile)
        - Be proactive in suggesting next steps
        - Analyze if shortlisted universities are suitable and suggest locking the best one
        
        CRITICAL - TOOL USAGE RULES:
        - You have access to tools/functions. The system will automatically handle tool calls for you.
        - NEVER write function calls as text like "<function=..." or "update_profile(...)". This will cause errors.
        - Simply describe what action you want to take and the system will invoke the appropriate tool.
        - If you want to update a profile field, use the update_profile tool through the normal tool calling mechanism.

        INTERACTION RULES:
        - If user says "my profile", "show profile", or "what do you know about me" -> DISPLAY the profile summary from your context. Do NOT call recommendations.
        - If user's input is vague (like "nmy profil;e"), invoke your reasoning capabilities to correct typos (e.g. assume "my profile") before acting.
        
        PERSONALIZATION RULE:
        - When providing recommendations or advice, ALWAYS reference the user's specific profile to show you understand their context.
        - Example: "Since you studied [Current Education] and want to pursue [Target Degree] in [Field]..."
        - Example: "Given your GPA of [GPA], I recommend..."
        
        IMPORTANT - When to use tools:
        - If user says "add task", "remind me", "create a task" → USE add_task tool
        - If user says "mark done", "completed", "finish task" → USE set_task_status tool (NEVER add_task)
        - If user says "shortlist", "add university", "add MIT" → USE shortlist_university tool (REQUIRED: Do NOT say you added it unless you call this tool)
        - If user asks for recommendations → USE get_university_recommendations tool (REQUIRED: You MUST use this tool. Do NOT invent/hallucinate a list of universities as arguments. call it with empty args or reason).
        - If user says "lock", "commit to", "choose [university]", "finalize" → USE lock_university tool (ONLY if university is already shortlisted)
        - ONLY use update_profile tool when user specifies BOTH the field AND the value clearly
          - CORRECT: "update my GPA to 3.8" → USE update_profile tool with field="gpa", value="3.8"
          - CORRECT: "change my IELTS score to 7.5" → USE update_profile tool with field="ielts_score", value="7.5"
          - WRONG: "update my profile" → DO NOT USE TOOL, instead ASK "What would you like to update? (GPA, IELTS score, budget, etc.)"
          - WRONG: "update my GPA" (no value) → DO NOT USE TOOL, instead ASK "What is your new GPA?"
          - VALUE PARSING: If user says "85k" or "50k", convert to "85000" or "50000" for the value parameter.
          - Can update: gpa, gpa_scale, ielts_score, ielts_status, toefl_score, gre_score, preferred_countries, budget_range_min, budget_range_max, target_intake_year, intended_degree, field_of_study, sop_status, funding_plan
        
        GPA SCALE CONVERSION - IMPORTANT:
        - If user wants to change their GPA scale (e.g., from 4.0 scale to 10.0 scale), you need to update BOTH fields:
          1. First update gpa_scale to the new scale (e.g., "10")
          2. Then update gpa to the CONVERTED value
        - Conversion formula: new_gpa = (old_gpa / old_scale) * new_scale
        - Example: 3.7/4.0 converted to 10-point scale = (3.7 / 4.0) * 10 = 9.25
        - ALWAYS ask user to confirm the converted value before updating
        - If user says "my GPA is 8.5/10", update gpa to "8.5" AND gpa_scale to "10"
        
        ${profileContext}
        
        CONTEXT-AWARE GUIDANCE:
        1. If task progress is 100% (ALL TASKS COMPLETE):
           - Congratulate the user! They're ready to submit their application
           - Guide them on: final application review, submission process, interview preparation
           - Suggest post-submission steps: tracking status, visa preparation, accommodation research
           
        2. If task progress is high (70-99%):
           - Focus on completing remaining high-priority tasks
           - Encourage them - they're almost there!
           
        3. If user has locked a university:
           - Focus advice on that specific university's requirements
           - Help with application-specific questions
           
        4. If no university is locked yet:
           - Help them choose and lock a university first
           
        
        When the user asks "what should I do next":
        - Check their task progress above
        - If 100% complete: guide on submission and next phase
        - If not complete: highlight pending high-priority tasks

        When the user asks to "check budget" or "check X":
        - Look at the User Profile context and state the value clearly.
        
        Be conversational, helpful, PROACTIVE, and ACTION-ORIENTED.
        VERIFICATION RULE: You must NEVER say "I have shortlisted" or "I have added a task" unless you are intentionally generating a tool call for it. If you cannot use the tool, admit it.
        Format responses with **bold** for emphasis, use bullet points for lists.`
      },
      ...recentHistory.map(msg => ({
        role: msg.role,
        content: msg.content
      })),
      { role: "user", content: message }
    ];

    // Save user message
    await Conversation.addMessage(conversation.id, "user", message);

    // Send conversation ID immediately
    res.write(`data: ${JSON.stringify({ type: 'start', conversation_id: conversation.id })}\n\n`);

    // Helper function to parse malformed function calls from text
    const parseMalformedToolCalls = (text) => {
      const toolCalls = [];
      // Match patterns like <function=name {...} </function> or <function=name {...} />
      // We use [\s\S]*? to match across newlines
      const pattern = /<function=(\w+)\s+([\s\S]*?)(?:<\/function>|\/>|$)/g;

      let match;
      while ((match = pattern.exec(text)) !== null) {
        const name = match[1];
        const argsText = match[2].trim();
        let args = {};

        try {
          if (argsText.startsWith('{') && (argsText.endsWith('}') || argsText.includes('}'))) {
            const lastBrace = argsText.lastIndexOf('}');
            const jsonPart = argsText.substring(0, lastBrace + 1);
            args = JSON.parse(jsonPart);
          } else {
            args = JSON.parse(`{${argsText}}`);
          }
        } catch (e) {
          console.log("JSON parse failed for malformed tool:", e.message);
          const kvPattern = /"(\w+)":\s*"([^"]*)"/g;
          let kvMatch;
          while ((kvMatch = kvPattern.exec(argsText)) !== null) {
            args[kvMatch[1]] = kvMatch[2];
          }
        }

        if (Object.keys(args).length > 0) {
          toolCalls.push({ name, args });
        }
      }

      // Pattern 2: Raw text style like "update_profile { ... }"
      const rawPattern = /(update_profile|shortlist_university|add_task|get_university_recommendations|lock_university)\s*(\{[^}]*\})/g;

      while ((match = rawPattern.exec(text)) !== null) {
        const name = match[1];
        const argsText = match[2].trim();
        try {
          const args = JSON.parse(argsText);
          toolCalls.push({ name, args });
        } catch (e) {
          console.log("Failed to parse raw text JSON:", e.message);
        }
      }

      return toolCalls;
    };

    let responseMessage;
    let usedFallback = false;
    let recoveredToolCalls = [];

    // STEP 1: Make initial call WITH tools to check if actions needed
    let toolChoice = "auto";
    const userMsgLower = message.toLowerCase();

    // Force tool usage for 8b model reliability
    if (userMsgLower.includes("shortlist") || (userMsgLower.includes("add") && (userMsgLower.includes("list") || userMsgLower.includes("university") || userMsgLower.includes("uni")))) {
      toolChoice = { type: "function", function: { name: "shortlist_university" } };
      console.log("Forcing tool: shortlist_university");
    } else if (userMsgLower.includes("recommend") || userMsgLower.includes("suggest universities") || (userMsgLower.includes("universities") && userMsgLower.includes("me"))) {
      toolChoice = { type: "function", function: { name: "get_university_recommendations" } };
      console.log("Forcing tool: get_university_recommendations");
    } else if (userMsgLower.includes("task") || userMsgLower.includes("remind") || userMsgLower.includes("to-do") || userMsgLower.includes("todo")) {
      toolChoice = { type: "function", function: { name: "add_task" } };
      console.log("Forcing tool: add_task");
    } else if (userMsgLower.includes("update") || userMsgLower.includes("set my") || userMsgLower.includes("change my")) {
      toolChoice = { type: "function", function: { name: "update_profile" } };
      console.log("Forcing tool: update_profile");
    }

    try {
      const initialCompletion = await groq.chat.completions.create({
        messages,
        model: "llama-3.1-8b-instant",
        tools,
        tool_choice: toolChoice,
        temperature: 0.7
      });
      responseMessage = initialCompletion.choices[0].message;
    } catch (toolError) {
      // If tool calling fails (malformed function call), try to recover from error message
      console.log("Tool calling failed:", toolError.message);

      // Attempt to extract failed generation from error object
      // The structure varies, check multiple places
      const failedGeneration = toolError.failed_generation ||
        toolError.error?.failed_generation ||
        toolError.error?.error?.failed_generation;

      if (failedGeneration) {
        console.log("Found failed_generation in error, attempting to parse:", failedGeneration);
        recoveredToolCalls = parseMalformedToolCalls(failedGeneration);
      }

      if (recoveredToolCalls.length > 0) {
        console.log("Successfully recovered tool calls:", recoveredToolCalls);
        // We recovered the tools, but we still need a text response
        usedFallback = true;
        responseMessage = {
          content: "", // Empty content triggers follow-up generation which will describe the actions taken
          tool_calls: [] // We'll handle these manually via recoveredToolCalls
        };
      } else {
        // Standard fallback if recovery failed
        console.log("Could not recover tool calls, retrying with text-only mode...");
        usedFallback = true;
        try {
          const retryCompletion = await groq.chat.completions.create({
            messages: [
              ...messages.slice(0, -1),
              {
                role: "user",
                content: messages[messages.length - 1].content + "\n\n(SYSTEM: The tool call failed. Please ignore the tool error and simply provide your best university recommendations in plain text.)"
              }
            ],
            model: "llama-3.1-8b-instant",
            temperature: 0.5
          });
          responseMessage = retryCompletion.choices[0].message;
        } catch (retryError) {
          console.error("Retry also failed:", retryError.message);
          responseMessage = {
            content: "I apologize, but I'm having trouble processing your request right now.",
            tool_calls: null
          };
        }
      }
    }

    const actions = [];

    // STEP 2: Execute any tool calls (or parse malformed ones from fallback)
    let toolCallsToExecute = recoveredToolCalls;
    if (toolCallsToExecute && toolCallsToExecute.length > 0) {
      console.log("Using successfully recovered tool calls:", toolCallsToExecute.length);
    } else {
      toolCallsToExecute = [];
    }

    // DEBUG: Log what we got from the model
    console.log("=== AI Response Debug ===");
    console.log("Has tool_calls:", !!responseMessage.tool_calls);
    console.log("Tool calls count:", responseMessage.tool_calls?.length || 0);
    console.log("Used fallback:", usedFallback);
    console.log("Content preview:", responseMessage.content?.substring(0, 200));
    if (responseMessage.tool_calls) {
      console.log("Tool calls:", JSON.stringify(responseMessage.tool_calls, null, 2));
    }

    if (toolCallsToExecute.length === 0 && responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
      // Normal tool calls
      toolCallsToExecute = responseMessage.tool_calls.map(tc => ({
        name: tc.function.name,
        args: JSON.parse(tc.function.arguments)
      }));
    } else if (toolCallsToExecute.length === 0 && responseMessage.content) {
      // Try to parse malformed function calls from the text response
      // We do this ALWAYS if there are no native tool calls, because the model might have just written the code as text
      const parsedCalls = parseMalformedToolCalls(responseMessage.content);
      if (parsedCalls.length > 0) {
        console.log("Parsed malformed tool calls from content:", parsedCalls);
        toolCallsToExecute = parsedCalls;
      }
    }

    if (toolCallsToExecute.length > 0) {
      for (const toolCall of toolCallsToExecute) {
        const functionName = toolCall.name;
        const functionArgs = toolCall.args;

        let result;
        let actionData;

        switch (functionName) {
          case "shortlist_university":
            result = await executeShortlist(user.id, functionArgs);
            actionData = {
              action: "shortlist_added",
              university: functionArgs.university_name,
              country: functionArgs.country,
              category: functionArgs.category,
              success: result.success
            };
            actions.push(actionData);
            // Send action event to frontend
            res.write(`data: ${JSON.stringify({ type: 'action', ...actionData })}\n\n`);
            break;

          case "add_task":
            result = await executeAddTask(user.id, functionArgs);
            actionData = {
              action: "task_added",
              task: functionArgs.title,
              category: functionArgs.category || 'other',
              priority: functionArgs.priority || 'medium',
              success: result.success
            };
            actions.push(actionData);
            // Send action event to frontend
            res.write(`data: ${JSON.stringify({ type: 'action', ...actionData })}\n\n`);
            break;

          case "get_university_recommendations":
            result = await executeGetRecommendations(user);
            actionData = {
              action: "recommendations_generated",
              count: result.count || 0,
              success: result.success,
              recommendations: result.recommendations // Pass raw data to frontend
            };
            actions.push(actionData);
            res.write(`data: ${JSON.stringify({ type: 'action', ...actionData })}\n\n`);
            break;

          case "lock_university":
            result = await executeLockUniversity(user.id, functionArgs, shortlist);
            actionData = {
              action: "university_locked",
              university: functionArgs.university_name,
              success: result.success,
              message: result.message
            };
            actions.push(actionData);
            res.write(`data: ${JSON.stringify({ type: 'action', ...actionData })}\n\n`);
            break;

          case "update_profile":
            result = await executeUpdateProfile(user.id, user.profile_data || {}, functionArgs);
            // IMPORTANT: Refresh user.profile_data so subsequent tool calls use fresh data
            if (result.success && result.updatedProfile) {
              user.profile_data = result.updatedProfile;
            }
            actionData = {
              action: "profile_updated",
              field: functionArgs.field,
              value: functionArgs.value,
              success: result.success,
              message: result.message
            };
            actions.push(actionData);
            res.write(`data: ${JSON.stringify({ type: 'action', ...actionData })}\n\n`);
            break;
        }
      }
    }

    // STEP 3: Get the AI's text response
    // If there were tool calls, we need to continue the conversation with tool results
    let aiReplyContent = responseMessage.content;

    // CLEANUP: Remove any raw function call text from the response before sending
    if (aiReplyContent) {
      // Pattern 1: XML-style <function=name>...</function>
      const xmlPattern = /<function=(\w+)\s+([\s\S]*?)(?:<\/function>|\/>|$)/g;

      // Pattern 2: Raw text style like "update_profile { ... }" or "shortlist_university({ ... })"
      // Matches: function_name followed by space/parenthesis and then { ... }
      const rawPattern = /(?:update_profile|shortlist_university|add_task|get_university_recommendations|lock_university)\s*(?:\{|[\(]\s*\{)[\s\S]*?(?:\}|[\)]\s*\})/g;

      aiReplyContent = aiReplyContent
        .replace(xmlPattern, '')
        .replace(rawPattern, '')
        .trim();
    }

    if (!aiReplyContent && actions.length > 0) {
      // AI only made tool calls, no text. Generate a follow-up response.
      let toolResultMessages;

      if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
        // Normal tool calls - include tool results
        toolResultMessages = [
          ...messages,
          responseMessage,
          ...responseMessage.tool_calls.map(tc => ({
            role: "tool",
            tool_call_id: tc.id,
            content: JSON.stringify({ success: true, message: "Action completed successfully" })
          }))
        ];
      } else {
        // Parsed malformed tool calls - just add a system message about completed actions
        toolResultMessages = [
          ...messages,
          {
            role: "assistant",
            content: `I've completed the following actions: ${actions.map(a => a.action).join(', ')}. Let me provide more details.`
          }
        ];
      }

      try {
        const followUp = await groq.chat.completions.create({
          messages: toolResultMessages,
          model: "llama-3.1-8b-instant", // Use versatile model for follow-up text generation
          temperature: 0.7,
          stream: true
        });

        let fullContent = '';
        for await (const chunk of followUp) {
          const content = chunk.choices[0]?.delta?.content || '';
          if (content) {
            fullContent += content;
            res.write(`data: ${JSON.stringify({ type: 'chunk', content })}\n\n`);
          }
        }
        aiReplyContent = fullContent;
      } catch (followUpError) {
        console.error("Follow-up generation error:", followUpError.message);
        const fallbackText = "Action completed successfully.";
        res.write(`data: ${JSON.stringify({ type: 'chunk', content: fallbackText })}\n\n`);
        aiReplyContent = fallbackText;
      }
    } else if (aiReplyContent) {
      // Stream the existing content character by character for typewriter effect
      // But since we already have the full content, we'll send it in chunks
      const chunkSize = 10;
      for (let i = 0; i < aiReplyContent.length; i += chunkSize) {
        const chunk = aiReplyContent.slice(i, i + chunkSize);
        res.write(`data: ${JSON.stringify({ type: 'chunk', content: chunk })}\n\n`);
        // Small delay for typewriter effect
        await new Promise(resolve => setTimeout(resolve, 15));
      }
    }

    // Save full response to conversation
    // Save full response to conversation
    if (aiReplyContent) {
      await Conversation.addMessage(conversation.id, "assistant", aiReplyContent);
    }

    // Send completion signal
    res.write(`data: ${JSON.stringify({
      type: 'done',
      full_content: aiReplyContent || '',
      actions: actions,
      has_actions: actions.length > 0
    })}\n\n`);
    res.end();

  } catch (err) {
    console.error("Stream chat error:", err);
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: err.message || 'An unexpected error occurred' })}\n\n`);
      res.end();
    }
  }
};

// @desc    Get all conversations for user
// @route   GET /api/ai/conversations
const getConversations = async (req, res) => {
  try {
    const conversations = await Conversation.findAllByUser(req.user.id);

    // Return with preview of first message
    const formatted = conversations.map(conv => ({
      id: conv.id,
      preview: conv.messages?.[0]?.content?.slice(0, 50) || 'New conversation',
      message_count: conv.messages?.length || 0,
      updated_at: conv.updated_at,
      created_at: conv.created_at
    }));

    res.json({ conversations: formatted });
  } catch (err) {
    console.error("Get conversations error:", err);
    res.status(500).json({ error: 'Server Error' });
  }
};

// @desc    Create new conversation
// @route   POST /api/ai/conversations/new
const createConversation = async (req, res) => {
  try {
    const conversation = await Conversation.create(req.user.id);
    res.status(201).json({
      conversation_id: conversation.id,
      message: "New conversation created"
    });
  } catch (err) {
    console.error("Create conversation error:", err);
    res.status(500).json({ error: 'Server Error' });
  }
};

// @desc    Delete conversation
// @route   DELETE /api/ai/conversations/:id
const deleteConversation = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await Conversation.delete(id, req.user.id);

    if (!deleted) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    res.json({ message: "Conversation deleted" });
  } catch (err) {
    console.error("Delete conversation error:", err);
    res.status(500).json({ error: 'Server Error' });
  }
};

// @desc    Load specific conversation
// @route   GET /api/ai/conversations/:id
const loadConversation = async (req, res) => {
  try {
    const { id } = req.params;
    const history = await Conversation.getHistory(id);

    res.json({
      conversation_id: id,
      messages: history
    });
  } catch (err) {
    console.error("Load conversation error:", err);
    res.status(500).json({ error: 'Server Error' });
  }
};

module.exports = {
  chatWithCounsellor,
  getConversation,
  clearConversation,
  streamChatWithCounsellor,
  getConversations,
  createConversation,
  deleteConversation,
  loadConversation
};