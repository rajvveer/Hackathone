const { pool } = require('../config/db');
const Shortlist = require('../models/shortlistModel');
const Task = require('../models/taskModel');
const Groq = require("groq-sdk");
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Helper: Get required documents based on country
const getRequiredDocuments = (country, degree) => {
    const commonDocs = [
        {
            name: "Statement of Purpose (SOP)",
            description: "1-2 page essay explaining your motivation and goals",
            status: "required",
            category: "essays",
            tips: [
                "Be specific about why this university and program",
                "Highlight relevant experience",
                "Show genuine interest and research"
            ]
        },
        {
            name: "Letters of Recommendation (LOR)",
            description: "2-3 letters from professors or employers",
            status: "required",
            category: "recommendations",
            tips: [
                "Choose recommenders who know you well",
                "Give them at least 3-4 weeks notice",
                "Provide them with your resume and goals"
            ]
        },
        {
            name: "Academic Transcripts",
            description: "Official transcripts from all institutions",
            status: "required",
            category: "academic",
            tips: [
                "Request official sealed transcripts",
                "Keep digital and physical copies",
                "Get translations if not in English"
            ]
        },
        {
            name: "Resume/CV",
            description: "Updated academic/professional resume",
            status: "required",
            category: "professional",
            tips: [
                "Highlight relevant experience",
                "Keep it to 1-2 pages",
                "Use clear, professional formatting"
            ]
        },
        {
            name: "Passport Copy",
            description: "Valid passport (at least 6 months validity)",
            status: "required",
            category: "identification"
        }
    ];

    const countryDocs = {
        "USA": [
            {
                name: "I-20 Form",
                description: "Certificate of Eligibility for F-1 status",
                status: "required",
                category: "visa",
                tips: ["Issued by university after admission", "Required for visa application"]
            },
            {
                name: "Financial Proof",
                description: "Bank statements showing $40-80K",
                status: "required",
                category: "financial",
                tips: ["Include sponsor affidavit if applicable", "Must cover 1 year of expenses"]
            },
            {
                name: "TOEFL/IELTS Score",
                description: "English proficiency test scores",
                status: "required",
                category: "tests"
            }
        ],
        "UK": [
            {
                name: "CAS Letter",
                description: "Confirmation of Acceptance for Studies",
                status: "required",
                category: "visa"
            },
            {
                name: "Financial Proof (28-day rule)",
                description: "Bank statements for visa application",
                status: "required",
                category: "financial"
            }
        ],
        "Canada": [
            {
                name: "Provincial Attestation Letter (PAL)",
                description: "Required for study permit (as of 2024)",
                status: "required",
                category: "visa"
            },
            {
                name: "Proof of Funds",
                description: "Show CAD $20,000+ for living expenses",
                status: "required",
                category: "financial"
            }
        ],
        "Germany": [
            {
                name: "Blocked Account (Sperrkonto)",
                description: "Proof of funds (~€11,000/year)",
                status: "required",
                category: "financial"
            },
            {
                name: "APS Certificate",
                description: "Academic evaluation (if from certain countries)",
                status: "conditional",
                category: "academic"
            }
        ]
    };

    // Master's specific documents
    if (degree === "Master's" || degree === "MBA") {
        commonDocs.push({
            name: "GRE/GMAT Scores",
            description: "Standardized test scores",
            status: "conditional",
            category: "tests",
            tips: ["Check if waived for your profile", "Aim for 320+ (GRE) or 700+ (GMAT)"]
        });
    }

    return [...commonDocs, ...(countryDocs[country] || [])];
};

// Helper: Generate application timeline using AI
const generateTimeline = async (profile, university) => {
    try {
        const currentDate = new Date();
        const targetIntake = new Date(profile.target_intake_year,
            profile.target_intake_season === 'Fall' ? 8 : 0, 1);

        const monthsUntilIntake = Math.max(0,
            (targetIntake.getFullYear() - currentDate.getFullYear()) * 12 +
            (targetIntake.getMonth() - currentDate.getMonth())
        );

        const prompt = `
      Generate an application timeline for:
      - University: ${university.uni_name}, ${university.country}
      - Target Intake: ${profile.target_intake_season} ${profile.target_intake_year}
      - Months until intake: ${monthsUntilIntake}
      - Current date: ${currentDate.toISOString().split('T')[0]}
      
      Create a realistic timeline with 5-7 key milestones from now until intake.
      
      Return JSON array:
      [
        {
          "phase": "Phase name",
          "deadline": "YYYY-MM-DD",
          "tasks": ["Task 1", "Task 2"],
          "status": "upcoming" or "current" or "urgent",
          "description": "What to focus on in this phase"
        }
      ]
      
      Phases should include: Test Prep, Document Prep, Application Submission, Visa Process, Pre-Departure
      Mark phases as "urgent" if less than 1 month away, "current" if within 1-3 months, "upcoming" if 3+ months away.
    `;

        const completion = await groq.chat.completions.create({
            messages: [{ role: "user", content: prompt }],
            model: "llama3-70b-8192",
            response_format: { type: "json_object" },
            temperature: 0.5
        });

        const result = JSON.parse(completion.choices[0].message.content);
        return result.timeline || result.milestones || [];
    } catch (err) {
        console.error("Timeline generation error:", err);
        // Return default timeline if AI fails
        return getDefaultTimeline(profile);
    }
};

const getDefaultTimeline = (profile) => {
    const now = new Date();
    return [
        {
            phase: "Test Preparation",
            deadline: new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            tasks: ["Complete IELTS/TOEFL", "Complete GRE/GMAT if required"],
            status: "current",
            description: "Focus on achieving target test scores"
        },
        {
            phase: "Document Preparation",
            deadline: new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            tasks: ["Draft SOP", "Request LORs", "Gather transcripts"],
            status: "upcoming",
            description: "Prepare all application materials"
        },
        {
            phase: "Application Submission",
            deadline: new Date(now.getTime() + 120 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            tasks: ["Submit application", "Pay application fee"],
            status: "upcoming",
            description: "Submit complete application before deadline"
        }
    ];
};

// @desc    Get Application Guidance
// @route   GET /api/application/guidance
const getApplicationGuidance = async (req, res) => {
    try {
        const user = req.user;
        const profile = user.profile_data || {};

        // Verify user has locked a university
        if (user.stage !== 4 || !user.locked_university_id) {
            return res.status(403).json({
                error: "Lock a university first",
                message: "You must lock a university to access application guidance",
                current_stage: user.stage
            });
        }

        // Get locked university details
        const university = await Shortlist.findById(user.locked_university_id);

        if (!university) {
            return res.status(404).json({ error: "Locked university not found" });
        }

        // Get all tasks for this university
        const tasks = await Task.findAllByUser(user.id);
        const uniTasks = tasks.filter(t => t.university_id === user.locked_university_id);

        // Generate timeline
        const timeline = await generateTimeline(profile, university);

        // Get required documents
        const documents = getRequiredDocuments(university.country, profile.intended_degree);

        // Calculate progress
        const taskStats = await Task.getStats(user.id);

        res.json({
            university: {
                id: university.id,
                name: university.uni_name,
                country: university.country,
                category: university.category,
                locked_at: user.locked_at,
                fit_analysis: {
                    fit_score: university.fit_score,
                    why_fits: university.why_fits,
                    key_risks: university.key_risks,
                    acceptance_chance: university.acceptance_chance
                }
            },
            timeline,
            required_documents: documents,
            tasks: {
                all: uniTasks,
                pending: uniTasks.filter(t => t.status === 'pending'),
                completed: uniTasks.filter(t => t.status === 'completed')
            },
            progress: {
                total_tasks: parseInt(taskStats.total),
                completed_tasks: parseInt(taskStats.completed),
                completion_percentage: taskStats.total > 0 ?
                    Math.round((taskStats.completed / taskStats.total) * 100) : 0,
                high_priority_pending: parseInt(taskStats.high_priority)
            },
            next_steps: uniTasks
                .filter(t => t.status === 'pending')
                .sort((a, b) => {
                    const priorityOrder = { high: 3, medium: 2, low: 1 };
                    return (priorityOrder[b.priority] || 0) - (priorityOrder[a.priority] || 0);
                })
                .slice(0, 5)
                .map(t => ({
                    task: t.title,
                    priority: t.priority,
                    category: t.category
                }))
        });

    } catch (err) {
        console.error("Application guidance error:", err);
        res.status(500).json({ error: 'Server Error' });
    }
};

module.exports = { getApplicationGuidance };
