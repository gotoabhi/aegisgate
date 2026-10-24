const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Helper for transient server errors (503 / 429)
async function generateWithRetry(model, prompt, retries = 3, delayMs = 1500) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await model.generateContent(prompt);
    } catch (err) {
      const isTransient = err.status === 503 || err.status === 429 || (err.message && err.message.includes('503'));
      if (isTransient && attempt < retries) {
        console.warn(`[Gemini 503/429] Temporary server load. Retrying attempt ${attempt + 1}/${retries} in ${delayMs}ms...`);
        await new Promise((res) => setTimeout(res, delayMs));
        delayMs *= 2; // exponential backoff
      } else {
        throw err;
      }
    }
  }
}

async function deidentifyClinicalNote(rawNote, framework = 'HIPAA_SAFE_HARBOR') {
  // Use gemini-3.5-flash-lite for high-throughput, low-latency document de-identification
  const model = genAI.getGenerativeModel({
    model: 'gemini-3.5-flash-lite',
    generationConfig: {
      responseMimeType: 'application/json',
    },
  });

  const prompt = `
You are an expert compliance auditor and clinical de-identification engine adhering to ${framework} and DPDP Act principles.

Task:
Analyze the following clinical note. Redact all Protected Health Information (PHI) and Personally Identifiable Information (PII).
Replace identified entities with standard categorical placeholders such as:
- [PATIENT_NAME]
- [FAMILY_MEMBER]
- [OCCUPATION]
- [GEOGRAPHIC_LOCATION]
- [HEALTHCARE_FACILITY]
- [DATE_OR_TIME]

CRITICAL CLINICAL PRESERVATION RULES:
1. Do NOT alter medical conditions, diagnoses, ICD descriptions, symptoms, or staging.
2. Do NOT alter medications, pharmaceutical names, or dosage amounts (e.g., Paclitaxel, Metformin 1000mg BID).
3. Do NOT alter clinical lab metrics, vitals, or numerical findings.

Raw Clinical Note:
"""
${rawNote}
"""

Return your output strictly as a JSON object matching this schema:
{
  "sanitizedText": "string",
  "redactedEntities": [
    {
      "original": "string",
      "category": "string",
      "replacement": "string"
    }
  ]
}
`;

  const result = await generateWithRetry(model, prompt);
  return JSON.parse(result.response.text());
}

module.exports = { deidentifyClinicalNote };