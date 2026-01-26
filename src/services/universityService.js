const axios = require('axios');
const { enrichUniversityData } = require('./aiService'); // We will build this next

// 1. Fetch Raw List from Free API
const fetchUniversityList = async (country, name) => {
  try {
    // Search by country and partial name
    let url = `http://universities.hipolabs.com/search?country=${country}`;
    if (name) url += `&name=${name}`;

    const response = await axios.get(url);
    // Limit to top 8 results to keep it fast for the demo
    return response.data.slice(0, 8); 
  } catch (error) {
    console.error("API Error:", error.message);
    return [];
  }
};

// 2. The "Standout" Feature: Get Real + AI Data
const searchUniversities = async (country, name) => {
  const rawList = await fetchUniversityList(country, name);
  if (rawList.length === 0) return [];

  // Pass the raw list to AI to "Fill in the blanks" (Fees, Acceptance Rate)
  const enrichedList = await enrichUniversityData(rawList);
  return enrichedList;
};

module.exports = { searchUniversities };