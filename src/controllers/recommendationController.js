const Groq = require("groq-sdk");
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const { pool } = require('../config/db');
const User = require('../models/userModel');
const RecommendationCache = require('../models/recommendationCacheModel');

// @desc    Generate Dream/Target/Safe Universities with Fit Analysis
// @route   GET /api/recommendations
const getRecommendations = async (req, res) => {
  try {
    const user = req.user;
    const profile = user.profile_data || {};

    // Check if profile is complete enough
    if (!profile.onboarding_completed) {
      return res.status(403).json({
        error: "Complete onboarding first",
        message: "Please finish your profile to get personalized recommendations",
        dream: [],
        target: [],
        safe: []
      });
    }

    // Minimum required fields
    if (!profile.gpa || !profile.preferred_countries || !profile.field_of_study) {
      return res.status(400).json({
        error: "Insufficient profile data",
        message: "Please add GPA, preferred countries, and field of study",
        dream: [],
        target: [],
        safe: []
      });
    }

    // Check cache first
    const profileHash = User.getProfileHash(profile);
    const cached = await RecommendationCache.get(user.id, profileHash);

    if (cached) {
      const cacheAge = Date.now() - new Date(cached.generated_at).getTime();
      const MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours

      if (cacheAge < MAX_AGE) {
        return res.json({
          ...cached.recommendations,
          cached: true,
          generated_at: cached.generated_at
        });
      }
    }

    // Generate fresh recommendations with comprehensive fit analysis
    const prompt = `
      Analyze this student profile and recommend universities with detailed fit analysis:
      
      PROFILE:
      - Current Education: ${profile.current_education_level}
      - GPA: ${profile.gpa}/${profile.gpa_scale || 4.0} (${((profile.gpa / (profile.gpa_scale || 4.0)) * 100).toFixed(1)}%)
      - Target Degree: ${profile.intended_degree}
      - Field: ${profile.field_of_study}
      - Budget: $${profile.budget_range_min}-${profile.budget_range_max}/year
      - Countries: ${profile.preferred_countries.join(", ")}
      - Intake: ${profile.target_intake_season} ${profile.target_intake_year}
      - IELTS: ${profile.ielts_status}${profile.ielts_score ? ` (${profile.ielts_score}/9)` : ''}
      - TOEFL: ${profile.toefl_status}${profile.toefl_score ? ` (${profile.toefl_score}/120)` : ''}
      - GRE: ${profile.gre_status}${profile.gre_score ? ` (${profile.gre_score}/340)` : ''}
      - Work Experience: ${profile.work_experience_years || 0} years
      - Research: ${profile.research_experience ? 'Yes' : 'No'}
      
      TASK: Generate REALISTIC university recommendations in 3 categories:
      
      1. DREAM (Top-tier, very competitive - acceptance chance < 30% for this profile)
      2. TARGET (Good fit, moderate competition - acceptance chance 40-70%)
      3. SAFE (High acceptance chance - > 70%)
      
      For EACH university, provide:
      {
        "name": "University Name",
        "location": "City, Country",
        "acceptance_rate": "XX%",
        "tuition_fee": "$XX,XXX/year",
        "ranking": "QS/Times ranking",
        "fit_score": 1-10 (how well it matches profile),
        "why_fits": "2-3 sentences explaining why this is a good match",
        "key_risks": ["Risk 1", "Risk 2"] (be honest about weaknesses),
        "acceptance_chance": "Low/Medium/High" (realistic for THIS student),
        "program_strength": "Brief note about program quality",
        "scholarship_available": true/false
      }
      
      IMPORTANT RULES:
      - Be REALISTIC about chances based on GPA and test scores
      - If GPA is below 3.0/4.0, don't recommend top-10 universities as "Target"
      - Consider budget constraints - suggest affordable options if budget is low
      - Check if universities actually offer programs in the specified field
      - Recommend 3-4 universities per category
      
      OUTPUT FORMAT: Valid JSON only
      {
        "dream": [university objects],
        "target": [university objects],
        "safe": [university objects]
      }
    `;

    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: "You are a university admissions data expert. Provide accurate, realistic recommendations based on actual university requirements and student profiles. Output JSON only."
        },
        { role: "user", content: prompt }
      ],
      model: "llama3-70b-8192",
      response_format: { type: "json_object" },
      temperature: 0.7
    });

    const recommendations = JSON.parse(completion.choices[0].message.content);

    // Ensure all required fields are present
    const validateUni = (uni) => ({
      name: uni.name || "Unknown",
      location: uni.location || "Unknown",
      acceptance_rate: uni.acceptance_rate || "N/A",
      tuition_fee: uni.tuition_fee || "N/A",
      ranking: uni.ranking || "N/A",
      fit_score: uni.fit_score || 5,
      why_fits: uni.why_fits || "Good match for your profile",
      key_risks: uni.key_risks || [],
      acceptance_chance: uni.acceptance_chance || "Medium",
      program_strength: uni.program_strength || "Strong program",
      scholarship_available: uni.scholarship_available || false
    });

    const validatedRecommendations = {
      dream: (recommendations.dream || []).map(validateUni),
      target: (recommendations.target || []).map(validateUni),
      safe: (recommendations.safe || []).map(validateUni),
      metadata: {
        generated_for: {
          gpa: profile.gpa,
          field: profile.field_of_study,
          budget: `$${profile.budget_range_min}-${profile.budget_range_max}`,
          countries: profile.preferred_countries
        },
        generated_at: new Date().toISOString(),
        total_universities: (recommendations.dream?.length || 0) +
          (recommendations.target?.length || 0) +
          (recommendations.safe?.length || 0)
      }
    };

    // Cache the recommendations
    await RecommendationCache.save(user.id, validatedRecommendations, profileHash);

    res.json({
      ...validatedRecommendations,
      cached: false
    });

  } catch (err) {
    console.error("Recommendations error:", err);
    res.status(500).json({
      error: 'Failed to generate recommendations',
      message: err.message,
      dream: [],
      target: [],
      safe: []
    });
  }
};

// @desc    Refresh recommendations (invalidate cache)
// @route   POST /api/recommendations/refresh
const refreshRecommendations = async (req, res) => {
  try {
    await RecommendationCache.invalidate(req.user.id);

    res.json({
      message: "Recommendation cache cleared. Call GET /api/recommendations to generate fresh ones."
    });
  } catch (err) {
    console.error("Refresh recommendations error:", err);
    res.status(500).json({ error: 'Server Error' });
  }
};

module.exports = { getRecommendations, refreshRecommendations };