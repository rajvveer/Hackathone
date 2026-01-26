const axios = require('axios');
const { enrichUniversityData } = require('./aiService'); // Keeps your AI logic separate

// Official API Endpoint from the documentation you shared
const BASE_URL = 'http://universities.hipolabs.com/search';

const searchUniversities = async (country, name) => {
  try {
    const params = {};
    if (country) params.country = country;
    if (name) params.name = name;

    // 1. Get Raw Data from HipoLabs
    const response = await axios.get(BASE_URL, { params });
    let rawList = response.data;

    // Safety: If API returns nothing, return empty array immediately
    if (!rawList || rawList.length === 0) return [];

    // Limit to top 10 results for speed (AI enrichment is slow)
    rawList = rawList.slice(0, 10);

    // 2. Enrich with AI (Rankings/Fees)
    const enrichedList = await enrichUniversityData(rawList);
    return enrichedList;

  } catch (error) {
    console.error("University API Error:", error.message);
    return []; // Return empty array so frontend doesn't crash
  }
};

module.exports = { searchUniversities };