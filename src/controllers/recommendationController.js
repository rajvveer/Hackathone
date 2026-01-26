const Groq = require("groq-sdk");
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// @desc    Generate Dream/Target/Safe Universities
// @route   GET /api/recommendations
const getRecommendations = async (req, res) => {
  try {
    const user = req.user;
    const profile = user.profile_data || {};

    // If profile is empty, return empty
    if (!profile.gpa || !profile.country) {
      return res.json({ dream: [], target: [], safe: [] });
    }

    // Ask AI to generate the list
    const prompt = `
      User Profile: GPA ${profile.gpa}, Budget ${profile.budget}, Target Country ${profile.country}, Major ${profile.degree}.
      
      Generate a JSON object with 3 arrays of universities:
      1. "dream" (High ranking, hard to get in)
      2. "target" (Good fit, 50-70% chance)
      3. "safe" (High acceptance chance)
      
      Each university object must have: { "name": "Uni Name", "location": "City", "acceptance_rate": "XX%" }
      
      OUTPUT JSON ONLY.
    `;

    const completion = await groq.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "llama3-8b-8192",
      response_format: { type: "json_object" }
    });

    const recommendations = JSON.parse(completion.choices[0].message.content);
    res.json(recommendations);

  } catch (err) {
    console.error("Rec Error:", err);
    res.status(500).json({ dream: [], target: [], safe: [] }); // Fail gracefully
  }
};

module.exports = { getRecommendations };