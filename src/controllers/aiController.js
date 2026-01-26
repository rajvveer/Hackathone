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
                enum: ["exams", "sop", "lor", "documents", "visa", "research", "other"],
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
      model: "llama3-70b-8192", // Using larger model for better function calling
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

module.exports = { chatWithCounsellor, getConversation, clearConversation };