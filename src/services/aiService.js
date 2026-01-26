const Groq = require("groq-sdk");
require('dotenv').config();

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// A. Chat with Counsellor (Used in aiController)
const generateChatResponse = async (userProfile, userMessage) => {
  const systemPrompt = `
    You are an expert Study Abroad Counsellor.
    User Profile: ${JSON.stringify(userProfile)}
    
    Be helpful, realistic, and concise. 
    If the budget is low, suggest affordable countries (Germany, Italy).
    If GPA is low, suggest "Safe" universities.
  `;

  const completion = await groq.chat.completions.create({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage }
    ],
    model: "llama3-8b-8192",
  });

  return completion.choices[0].message.content;
};

// B. Data Enrichment (Used in universityService)
const enrichUniversityData = async (uniList) => {
  const uniNames = uniList.map(u => u.name).join(", ");
  
  try {
    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: `You are a database. I will give you university names.
          Return a JSON OBJECT with a key "data" containing an array.
          Each object must have:
          - name (exact match)
          - global_ranking (approx number)
          - tuition_fees (approx USD/year)
          - acceptance_rate (approx %)
          
          OUTPUT JSON ONLY. NO TEXT.`
        },
        { role: "user", content: `Universities: ${uniNames}` }
      ],
      model: "llama3-8b-8192",
      response_format: { type: "json_object" }
    });

    const aiData = JSON.parse(completion.choices[0].message.content);
    
    // Merge AI data with original list
    return uniList.map(uni => {
      const details = aiData.data?.find(d => d.name.includes(uni.name)) || {};
      return { ...uni, ...details };
    });

  } catch (error) {
    console.error("AI Enrichment Failed:", error);
    return uniList; // Return basic list if AI fails
  }
};

// C. Recommendations (Used in recommendationController)
const generateRecommendations = async (profile) => {
  try {
    const prompt = `
      User: GPA ${profile.gpa}, Budget ${profile.budget}, Country ${profile.country}, Major ${profile.degree}.
      Generate 3 lists (Dream, Target, Safe) of universities.
      Output JSON with keys: "dream", "target", "safe".
      Include name, location, and acceptance_rate for each.
    `;

    const completion = await groq.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "llama3-8b-8192",
      response_format: { type: "json_object" }
    });

    return JSON.parse(completion.choices[0].message.content);
  } catch (error) {
    return { dream: [], target: [], safe: [] };
  }
};

module.exports = { generateChatResponse, enrichUniversityData, generateRecommendations };