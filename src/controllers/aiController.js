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
  const { pool } = require('../config/db');
  let user;
  try {
    const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    user = userResult.rows[0];
  } catch (err) {
    user = req.user; // Fallback
  }

  // Set up SSE headers - Critical for streaming
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable Nginx buffering
  res.flushHeaders();

  try {
    // OPTIMIZED: Reduce parallel fetching load
    // We only fetch what is strictly necessary for the prompt
    console.time("Context Fetch");
    const [conversation, shortlistResult, tasksResult] = await Promise.all([
      Conversation.getOrCreate(user.id),
      Shortlist.findAllByUser(user.id),
      Task.findAllByUser(user.id)
    ]);
    console.timeEnd("Context Fetch");

    // Process shortlist (Optimize: limited details)
    const shortlist = shortlistResult || [];
    const lockedUni = shortlist.find(s => s.id === user.locked_university_id);
    // OPTIMIZATION: Limit shortlist context size
    const shortlistSummary = shortlist.length > 0
      ? shortlist.map(s => `${s.uni_name} (${s.category})`).join(', ')
      : 'None';

    // Process tasks (Optimize: summary only, not full list)
    const tasks = tasksResult || [];
    user.tasks = tasks; // Attach for tools
    const completedTasks = tasks.filter(t => t.status === 'completed').length;
    const totalTasks = tasks.length;
    const taskProgress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    // Only list high priority pending tasks to save tokens
    const pendingHighPriority = tasks
      .filter(t => t.status === 'pending' && t.priority === 'high')
      .map(t => t.title)
      .slice(0, 5); // Max 5 tasks

    // Build concise context strings
    const shortlistContext = `Shortlist: ${shortlistSummary}${lockedUni ? `. Locked: ${lockedUni.uni_name}` : ''}`;

    let taskContext = `Tasks: ${completedTasks}/${totalTasks} done (${taskProgress}%).`;
    if (pendingHighPriority.length > 0) {
      taskContext += ` Priority: ${pendingHighPriority.join(', ')}`;
    }

    // Build profile text (Concise version)
    const profile = user.profile_data || {};
    const profileContext = `
      Profile: ${user.name}, ${profile.intended_degree || "Degree?"} in ${profile.field_of_study || "Field?"}.
      Stage: ${user.stage}/4. GPA: ${profile.gpa || "?"}. IELTS: ${profile.ielts_score || "?"}.
      Budget: ${profile.budget_range_max || "?"}.
      ${shortlistContext}
      ${taskContext}
    `;

    // Define tools (kept same)
    const tools = [
      {
        type: "function",
        function: {
          name: "shortlist_university",
          description: "Add a university to the user's shortlist with category (Dream/Target/Safe).",
          parameters: {
            type: "object",
            properties: {
              university_name: { type: "string" },
              country: { type: "string" },
              category: { type: "string", enum: ["Dream", "Target", "Safe"] },
              why_fits: { type: "string" },
              acceptance_chance: { type: "string", enum: ["Low", "Medium", "High"] }
            },
            required: ["university_name", "country", "category"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "add_task",
          description: "CREATE A NEW TASK.",
          parameters: {
            type: "object",
            properties: {
              title: { type: "string" },
              description: { type: "string" },
              category: { type: "string", enum: ["exams", "sop", "lor", "documents", "visa", "research", "profile", "other"] },
              priority: { type: "string", enum: ["high", "medium", "low"] }
            },
            required: ["title"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "get_university_recommendations",
          description: "Generate fresh personalized university recommendations",
          parameters: { type: "object", properties: {} }
        }
      },
      {
        type: "function",
        function: {
          name: "lock_university",
          description: "Lock a shortlisted university as the user's primary choice.",
          parameters: {
            type: "object",
            properties: {
              university_name: { type: "string" }
            },
            required: ["university_name"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "update_profile",
          description: "Update the user's profile information.",
          parameters: {
            type: "object",
            properties: {
              field: {
                type: "string",
                enum: [
                  "gpa", "gpa_scale", "ielts_status", "ielts_score", "toefl_status", "toefl_score",
                  "gre_status", "gre_score", "gmat_status", "gmat_score", "sop_status",
                  "preferred_countries", "budget_range_min", "budget_range_max",
                  "target_intake_year", "target_intake_season", "intended_degree", "field_of_study",
                  "current_education_level", "work_experience_years", "funding_plan"
                ]
              },
              value: { type: "string" }
            },
            required: ["field", "value"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "set_task_status",
          description: "Update the status of an existing task.",
          parameters: {
            type: "object",
            properties: {
              task_keyword: { type: "string" },
              status: { type: "string", enum: ["completed", "pending"] }
            },
            required: ["task_keyword", "status"]
          }
        }
      }
    ];

    // OPTIMIZATION: Limit history to last 10 messages instead of 20
    const history = conversation.messages || [];
    const recentHistory = history.slice(-10);

    const messages = [
      {
        role: "system",
        content: `You are an expert Study Abroad Counsellor.
        
        Role:
        - Provide realistic, honest advice.
        - Be strict if profile is weak.
        - Use tools to Take Actions (Shortlist, Add Task, Update Profile).
        
        Context:
        ${profileContext}
        
        Tools:
        - shortlist_university: Add to list
        - add_task: Create new task
        - set_task_status: Mark task done/pending
        - get_university_recommendations: Get suggestions
        - lock_university: Lock final choice
        - update_profile: Update user data
        
        Be concise. Use headers/bullets.`
      },
      ...recentHistory.map(msg => ({ role: msg.role, content: msg.content })),
      { role: "user", content: message }
    ];

    // Save user message immediately
    // We don't await this to speed up initial response
    Conversation.addMessage(conversation.id, "user", message).catch(err => console.error("Error saving user msg:", err));

    // Send conversation ID immediately
    res.write(`data: ${JSON.stringify({ type: 'start', conversation_id: conversation.id })}\n\n`);

    console.time("Groq Stream");

    // TRUE STREAMING CALL
    const stream = await groq.chat.completions.create({
      messages,
      model: "llama-3.1-8b-instant",
      tools,
      tool_choice: "auto",
      temperature: 0.7,
      stream: true // Enable streaming
    });

    let fullContent = "";
    let toolCalls = [];
    let currentToolCall = null;

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;

      // Handle Content
      if (delta?.content) {
        fullContent += delta.content;
        // Stream content chunk directly to client
        res.write(`data: ${JSON.stringify({ type: 'chunk', content: delta.content })}\n\n`);
      }

      // Handle Tool Calls (Accumulate)
      if (delta?.tool_calls) {
        for (const toolCallChunk of delta.tool_calls) {
          if (toolCallChunk.id) {
            // New tool call starting
            if (currentToolCall) {
              toolCalls.push(currentToolCall);
            }
            currentToolCall = {
              id: toolCallChunk.id,
              name: toolCallChunk.function?.name || "",
              args: toolCallChunk.function?.arguments || ""
            };
          } else if (currentToolCall) {
            // Continuing existing tool call
            if (toolCallChunk.function?.name) {
              currentToolCall.name += toolCallChunk.function.name;
            }
            if (toolCallChunk.function?.arguments) {
              currentToolCall.args += toolCallChunk.function.arguments;
            }
          }
        }
      }
    }

    // Push the last tool call if exists
    if (currentToolCall) {
      toolCalls.push(currentToolCall);
    }

    console.timeEnd("Groq Stream");

    // Execute Tool Calls if any
    const actions = [];
    if (toolCalls.length > 0) {
      console.log(`Executing ${toolCalls.length} tool calls...`);

      for (const tc of toolCalls) {
        try {
          const functionName = tc.name;
          const functionArgs = JSON.parse(tc.args);
          let result;
          let actionData;

          switch (functionName) {
            case "shortlist_university":
              result = await executeShortlist(user.id, functionArgs);
              actionData = {
                action: "shortlist_added",
                university: functionArgs.university_name,
                category: functionArgs.category,
                success: result.success
              };
              break;

            case "add_task":
              result = await executeAddTask(user.id, functionArgs);
              actionData = {
                action: "task_added",
                task: functionArgs.title,
                success: result.success
              };
              break;

            case "get_university_recommendations":
              result = await executeGetRecommendations(user);
              actionData = {
                action: "recommendations_generated",
                count: result.count || 0,
                success: result.success,
                recommendations: result.recommendations
              };
              break;

            case "lock_university":
              result = await executeLockUniversity(user.id, functionArgs, shortlist);
              actionData = {
                action: "university_locked",
                university: functionArgs.university_name,
                success: result.success
              };
              break;

            case "update_profile":
              result = await executeUpdateProfile(user.id, user.profile_data || {}, functionArgs);
              actionData = {
                action: "profile_updated",
                field: functionArgs.field,
                value: functionArgs.value,
                success: result.success
              };
              break;

            case "set_task_status":
              result = await executeUpdateTask(user.id, functionArgs, tasks);
              actionData = {
                action: "task_updated",
                task: functionArgs.task_keyword,
                status: functionArgs.status,
                success: result.success
              };
              break;
          }

          if (actionData) {
            actions.push(actionData);
            // Stream action to client immediately
            res.write(`data: ${JSON.stringify({ type: 'action', ...actionData })}\n\n`);
          }

        } catch (e) {
          console.error("Tool execution error:", e);
        }
      }

      // If we had tool calls but no content, we might want to generate a follow-up summary
      // If we had tool calls but no content, we MUST generate a follow-up summary
      if (!fullContent && actions.length > 0) {

        // Construct the assistant message that just happened
        const assistantMessage = {
          role: "assistant",
          content: null,
          tool_calls: toolCalls.map(tc => ({
            id: tc.id,
            type: "function",
            function: { name: tc.name, arguments: tc.args }
          }))
        };

        const toolResultMessages = [
          ...messages,
          assistantMessage,
          ...toolCalls.map((tc, index) => ({
            role: "tool",
            tool_call_id: tc.id,
            content: JSON.stringify(actions[index] || { success: true })
          }))
        ];

        try {
          const followUp = await groq.chat.completions.create({
            messages: toolResultMessages,
            model: "llama-3.1-8b-instant",
            temperature: 0.7,
            stream: true
          });

          for await (const chunk of followUp) {
            const content = chunk.choices[0]?.delta?.content || '';
            if (content) {
              fullContent += content;
              res.write(`data: ${JSON.stringify({ type: 'chunk', content })}\n\n`);
            }
          }
        } catch (e) {
          console.error("Follow-up generation error:", e);
          const fallback = "I've completed the requested actions.";
          res.write(`data: ${JSON.stringify({ type: 'chunk', content: fallback })}\n\n`);
          fullContent += fallback;
        }
      }
    }

    // Save assistant response
    if (fullContent) {
      Conversation.addMessage(conversation.id, "assistant", fullContent).catch(e => console.error("Error saving specific msg", e));
    }

    // Done signal
    res.write(`data: ${JSON.stringify({
      type: 'done',
      full_content: fullContent,
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