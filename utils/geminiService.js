// utils/geminiService.js
// Real analysis via Gemini API: extraction from image + independent assessment + cross-check.
// The API key is read from the .env file (EXPO_PUBLIC_GEMINI_API_KEY); it is never hardcoded.

import * as FileSystem from 'expo-file-system/legacy';

const GEMINI_API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY;

// Note: gemini-2.0-flash was retired on June 1, 2026. This is the current model.
// If an error occurs, change the model name here (e.g. 'gemini-2.5-flash-lite').
const MODEL = 'gemini-2.5-flash';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

// --- Helper: convert an image URI to base64 ---
async function uriToBase64(uri) {
  try {
    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType ? FileSystem.EncodingType.Base64 : 'base64',
    });
    return base64;
  } catch (error) {
    console.error('uriToBase64 error', uri, error);
    throw new Error('IMAGE_READ_FAILED');
  }
}

// --- Helper: extract plain text from the Gemini response ---
function extractText(data) {
  try {
    const parts = data?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) return '';
    return parts.map((p) => p?.text || '').join('\n').trim();
  } catch {
    return '';
  }
}

// --- Helper: parse JSON from text (strips ```json fences) ---
function safeParseJson(text) {
  if (!text) return null;
  let cleaned = text.trim();
  // Strip ```json ... ``` or ``` ... ``` blocks
  cleaned = cleaned.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // Try to find an embedded { ... } block
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

// --- Low level: send a request to Gemini ---
async function callGemini(parts) {
  if (!GEMINI_API_KEY) {
    throw new Error('NO_API_KEY');
  }

  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'application/json',
    },
  };

  const response = await fetch(`${ENDPOINT}?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error('Gemini API error', response.status, errText);
    throw new Error(`GEMINI_HTTP_${response.status}`);
  }

  const data = await response.json();
  const text = extractText(data);
  return safeParseJson(text);
}

// === LAYER 1: Extraction from image + independent AI assessment ===
// imageUris: string[] (gallery/camera URIs)
// locale: 'tr' | 'en'  -> AI explanations are produced in this language
export async function extractAndAssess(imageUris, locale) {
  const lang = locale === 'tr' ? 'Turkish' : 'English';

  // Convert images to base64 and build the parts array
  const imageParts = [];
  for (const uri of imageUris) {
    const base64 = await uriToBase64(uri);
    imageParts.push({
      inlineData: { mimeType: 'image/jpeg', data: base64 },
    });
  }

  const prompt = `You are a scam-detection assistant. The user uploaded screenshot(s) of a possibly suspicious message (email, SMS, notification, etc.).

Do TWO things:
1. EXTRACT everything from the image(s): all visible text, any URLs/links, sender email address, the brand or organization being shown or impersonated, and any urgency/threat language.
2. INDEPENDENTLY ASSESS, from scratch, whether this looks like a scam — and why.

Respond ONLY with a JSON object (no markdown, no extra text) in this exact shape:
{
  "extractedText": "all readable text from the image, joined with newlines",
  "detectedBrand": "the brand/org name shown or impersonated, or empty string if none",
  "senderEmail": "sender email address if visible, else empty string",
  "urls": ["every distinct url or domain visible in the message"],
  "urgencyTone": true or false,
  "aiVerdict": "safe" | "careful" | "scam",
  "aiRiskScore": a number 0-100,
  "aiReasons": ["short reasons for your verdict, each one sentence"]
}

Write the values of "aiReasons" in ${lang}. Keep "extractedText", "urls", "senderEmail", "detectedBrand" as the raw values you see (do not translate those).`;

  const parts = [{ text: prompt }, ...imageParts];
  const result = await callGemini(parts);

  // Safe defaults (so the app does not crash if parsing fails)
  return {
    extractedText: result?.extractedText || '',
    detectedBrand: result?.detectedBrand || '',
    senderEmail: result?.senderEmail || '',
    urls: Array.isArray(result?.urls) ? result.urls : [],
    urgencyTone: !!result?.urgencyTone,
    aiVerdict: result?.aiVerdict || 'careful',
    aiRiskScore: typeof result?.aiRiskScore === 'number' ? result.aiRiskScore : 60,
    aiReasons: Array.isArray(result?.aiReasons) ? result.aiReasons : [],
  };
}

// === LAYER 3: Have the AI cross-check the algorithm's findings ===
// extracted: output of extractAndAssess
// algoFindings: findings from linkAnalyzer (string[])
export async function crossCheck(extracted, algoFindings, locale) {
  const lang = locale === 'tr' ? 'Turkish' : 'English';

  const prompt = `You are a scam-detection assistant doing a final review.

The message context:
- Extracted text: ${JSON.stringify(extracted.extractedText).slice(0, 2000)}
- Detected brand: ${extracted.detectedBrand || '(none)'}
- Sender email: ${extracted.senderEmail || '(none)'}
- URLs found: ${JSON.stringify(extracted.urls)}
- Your earlier independent verdict: ${extracted.aiVerdict} (${extracted.aiRiskScore}/100)

A separate rule-based algorithm analyzed the links and produced these technical findings:
${JSON.stringify(algoFindings)}

Review the algorithm's findings. Confirm the ones you agree with, give a FINAL combined verdict, and SEPARATE your observations into negative (threat) signals and positive (reassuring) signals.

Respond ONLY with a JSON object (no markdown) in this shape:
{
  "finalVerdict": "safe" | "careful" | "scam",
  "finalRiskScore": a number 0-100,
  "threatSignals": ["only the NEGATIVE / suspicious findings, each one sentence"],
  "positiveSignals": ["only the POSITIVE / reassuring findings, e.g. legitimate domain, no urgency, consistent sender — each one sentence"],
  "recommendation": "one short, SPECIFIC sentence telling the user what to do, matched to the actual risk level (do not warn about clicking links if the message looks safe)"
}

If there are no genuine threat signals, "threatSignals" must be an empty array. If there are no positive signals, "positiveSignals" must be empty. Write "threatSignals", "positiveSignals", and "recommendation" in ${lang}.`;

  const result = await callGemini([{ text: prompt }]);

  return {
    finalVerdict: result?.finalVerdict || extracted.aiVerdict || 'careful',
    finalRiskScore:
      typeof result?.finalRiskScore === 'number' ? result.finalRiskScore : extracted.aiRiskScore || 60,
    threatSignals: Array.isArray(result?.threatSignals) ? result.threatSignals : [],
    positiveSignals: Array.isArray(result?.positiveSignals) ? result.positiveSignals : [],
    recommendation: result?.recommendation || '',
  };
}
