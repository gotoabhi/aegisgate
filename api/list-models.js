require('dotenv').config();

const apiKey = process.env.GEMINI_API_KEY;

async function listSupportedModels() {
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
  const response = await fetch(url);
  const data = await response.json();

  if (data.error) {
    console.error('Error listing models:', data.error);
    return;
  }

  console.log('\n--- Supported Models for generateContent ---');
  const validModels = (data.models || [])
    .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
    .map(m => m.name.replace('models/', ''));

  console.log(validModels);
}

listSupportedModels();