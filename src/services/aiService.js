const Groq = require("groq-sdk");
require('dotenv').config();

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Generate chat response with profile context
const generateChatResponse = async (userProfile, userMessage) => {
  const systemPrompt = `
    You are an expert Study Abroad Counsellor.
    User Profile: ${JSON.stringify(userProfile)}
    
    Be helpful, realistic, and concise. 
    - If budget is low, suggest affordable countries (Germany, Norway, scholarships)
    - If GPA is low, suggest "Safe" universities
    - Be honest about chances
    - Provide actionable advice
  `;

  try {
    const completion = await groq.chat.completions.create({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage }
      ],
      model: "llama3-70b-8192",
      temperature: 0.7
    });

    return completion.choices[0].message.content;
  } catch (err) {
    console.error("AI chat error:", err);
    throw new Error("Failed to generate AI response");
  }
};

// Generate university recommendations
const generateRecommendations = async (profile) => {
  try {
    if (!profile.gpa || !profile.preferred_countries || !profile.field_of_study) {
      return { dream: [], target: [], safe: [] };
    }

    const prompt = `
      Student Profile:
      - GPA: ${profile.gpa}/${profile.gpa_scale || 4.0}
      - Budget: $${profile.budget_range_min}-${profile.budget_range_max}/year
      - Countries: ${profile.preferred_countries?.join(", ")}
      - Field: ${profile.field_of_study}
      - Degree: ${profile.intended_degree}
      
      Generate realistic university recommendations in 3 categories (Dream, Target, Safe).
      Each university needs: name, location, acceptance_rate
      
      Output JSON:
      {
        "dream": [{name, location, acceptance_rate}],
        "target": [{name, location, acceptance_rate}],
        "safe": [{name, location, acceptance_rate}]
      }
    `;

    const completion = await groq.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "llama3-70b-8192",
      response_format: { type: "json_object" },
      temperature: 0.7
    });

    return JSON.parse(completion.choices[0].message.content);
  } catch (error) {
    console.error("Recommendations generation error:", error);
    return { dream: [], target: [], safe: [] };
  }
};

// Enrich university data with additional details
const enrichUniversityData = async (uniList) => {
  if (!uniList || uniList.length === 0) return [];

  const uniNames = uniList.map(u => u.name).join(", ");

  try {
    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: `You are a university data expert. Return JSON with university details.
          Format: {"data": [{"name": "...", "global_ranking": 123, "tuition_fees": "...", "acceptance_rate": "..."}]}`
        },
        { role: "user", content: `Universities: ${uniNames}` }
      ],
      model: "llama3-70b-8192",
      response_format: { type: "json_object" },
      temperature: 0.5
    });

    const aiData = JSON.parse(completion.choices[0].message.content);

    // Merge AI data with original list
    return uniList.map(uni => {
      const details = aiData.data?.find(d => d.name?.includes(uni.name)) || {};
      return { ...uni, ...details };
    });

  } catch (error) {
    console.error("AI Enrichment Failed:", error);
    return uniList; // Return basic list if AI fails
  }
};

// Analyze profile and provide insights
const analyzeProfile = async (profile) => {
  try {
    const prompt = `
      Analyze this student profile and provide honest feedback:
      
      - GPA: ${profile.gpa}/${profile.gpa_scale || 4.0}
      - Field: ${profile.field_of_study}
      - Target Degree: ${profile.intended_degree}
      - Budget: $${profile.budget_range_min}-${profile.budget_range_max}
      - Test Scores: IELTS ${profile.ielts_score || 'N/A'}, GRE ${profile.gre_score || 'N/A'}
      - Work Experience: ${profile.work_experience_years || 0} years
      
      Provide:
      1. Strength: What's strong about this profile
      2. Weaknesses: What needs improvement
      3. Recommendations: 3 specific action items
      
      Return JSON:
      {
        "strength": "...",
        "weaknesses": ["...", "..."],
        "recommendations": ["...", "...", "..."],
        "competitiveness": "High/Medium/Low"
      }
    `;

    const completion = await groq.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "llama3-70b-8192",
      response_format: { type: "json_object" },
      temperature: 0.6
    });

    return JSON.parse(completion.choices[0].message.content);
  } catch (error) {
    console.error("Profile analysis error:", error);
    return {
      strength: "Unable to analyze",
      weaknesses: [],
      recommendations: [],
      competitiveness: "Unknown"
    };
  }
};

module.exports = {
  generateChatResponse,
  enrichUniversityData,
  generateRecommendations,
  analyzeProfile
};