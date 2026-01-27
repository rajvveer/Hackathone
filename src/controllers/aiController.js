const Groq = require("groq-sdk");
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
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
            properties: {}
          }
        }
      }
    ];

    // Get conversation history
    const history = conversation.messages || [];
    const recentHistory = history.slice(-10); // Last 10 messages

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
        
        Important guidelines:
        - If budget is low (<$20k/year), suggest affordable countries like Germany, Norway, or scholarships
        - If GPA is below 3.0/4.0 (75%), be cautious about top universities
        - Always explain WHY a university fits or doesn't fit
        - Highlight risks honestly (e.g., "Your GPA is below their average")
        - Encourage preparation (exams, SOP) before applications
        
        ${profileContext}
        
        You can use these functions:
        1. shortlist_university - When you recommend a specific university
        2. add_task - When you identify action items for the user
        3. get_university_recommendations - To generate fresh recommendations
        
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
      model: "llama-3.3-70b-versatile", // Updated model - llama3-70b-8192 was decommissioned
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

// Helper: Execute get recommendations action
const executeGetRecommendations = async (user) => {
  try {
    const recommendations = await generateRecommendations(user.profile_data);

    return {
      success: true,
      recommendations
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
      message: `Updated ${displayField} to "${value}"`
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
  const user = req.user;

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  try {
    // Get or create conversation
    let conversation = await Conversation.getOrCreate(user.id);

    // Fetch user's shortlist for context
    const shortlistResult = await Shortlist.findAllByUser(user.id);
    const shortlist = shortlistResult || [];
    const lockedUni = shortlist.find(s => s.id === user.locked_university_id);

    // Fetch user's tasks for progress context
    const tasksResult = await Task.findAllByUser(user.id);
    const tasks = tasksResult || [];
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
        : pendingHighPriority.length > 0
          ? `\n      High Priority Pending: ${pendingHighPriority.map(t => t.title).join(', ')}`
          : ''
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
          description: "Add a task to the user's to-do list. Use this when the user asks you to add, create, or remind them about a task.",
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
                description: "The new value for the field. For arrays like preferred_countries, use comma-separated values. For status fields use: not-started, in-progress, completed. For scores, use numeric values."
              }
            },
            required: ["field", "value"]
          }
        }
      }
    ];

    // Get conversation history
    const history = conversation.messages || [];
    const recentHistory = history.slice(-10);

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
        
        IMPORTANT - When to use tools:
        - If user says "add task", "remind me", "create a task" → USE add_task tool
        - If user says "shortlist", "add university", "add MIT" → USE shortlist_university tool
        - If user asks for recommendations → USE get_university_recommendations tool
        - If user says "lock", "commit to", "choose [university]", "finalize" → USE lock_university tool (ONLY if university is already shortlisted)
        - ONLY use update_profile tool when user specifies BOTH the field AND the value clearly
          - CORRECT: "update my GPA to 3.8" → USE update_profile(gpa, 3.8)
          - CORRECT: "change my IELTS score to 7.5" → USE update_profile(ielts_score, 7.5)
          - WRONG: "update my profile" → DO NOT USE TOOL, instead ASK "What would you like to update? (GPA, IELTS score, budget, etc.)"
          - WRONG: "update my GPA" (no value) → DO NOT USE TOOL, instead ASK "What is your new GPA?"
          - Can update: gpa, ielts_score, ielts_status, toefl_score, gre_score, preferred_countries, budget_range_min, budget_range_max, target_intake_year, intended_degree, field_of_study, sop_status, funding_plan
        
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
        
        Be conversational, helpful, and ACTION-ORIENTED. When you execute a tool, confirm what you did.
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

    // STEP 1: Make initial call WITH tools to check if actions needed
    const initialCompletion = await groq.chat.completions.create({
      messages,
      model: "llama-3.3-70b-versatile",
      tools,
      tool_choice: "auto",
      temperature: 0.7
    });

    const responseMessage = initialCompletion.choices[0].message;
    const actions = [];

    // STEP 2: Execute any tool calls
    if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
      for (const toolCall of responseMessage.tool_calls) {
        const functionName = toolCall.function.name;
        const functionArgs = JSON.parse(toolCall.function.arguments);

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
              success: result.success
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

    if (!aiReplyContent && actions.length > 0) {
      // AI only made tool calls, no text. Generate a follow-up response.
      const toolResultMessages = [
        ...messages,
        responseMessage,
        ...responseMessage.tool_calls.map(tc => ({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify({ success: true, message: "Action completed successfully" })
        }))
      ];

      const followUp = await groq.chat.completions.create({
        messages: toolResultMessages,
        model: "llama-3.3-70b-versatile",
        tools,
        tool_choice: "none", // Prevent AI from calling tools in follow-up
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
    res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
    res.end();
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