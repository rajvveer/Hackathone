const Groq = require("groq-sdk");
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const chatWithCounsellor = async (req, res) => {
  const { message } = req.body;
  const user = req.user; // We have access to user profile!

  try {
    // Construct the "System Context"
    const profileContext = `
      User Profile:
      - Name: ${user.name}
      - GPA/Grades: ${user.profile_data?.gpa || "Not set"}
      - Budget: ${user.profile_data?.budget || "Not set"}
      - Preferred Country: ${user.profile_data?.country || "Not set"}
      - Current Stage: ${user.stage} (1=Profile, 2=Discovery, 3=Shortlist, 4=Locked)
    `;

    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: `You are an expert Study Abroad Counsellor. 
          Be strict, helpful, and realistic. 
          Use the profile data below to give personalized advice.
          If their budget is low, warn them about expensive cities.
          
          ${profileContext}`
        },
        { role: "user", content: message }
      ],
      model: "llama3-8b-8192",
    });

    res.json({ reply: completion.choices[0].message.content });

  } catch (err) {
    console.error(err);
    res.status(500).send('AI Error');
  }
};

module.exports = { chatWithCounsellor };