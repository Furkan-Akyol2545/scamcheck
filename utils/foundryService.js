// utils/foundryService.js
// Scam analysis powered by Microsoft Foundry (Azure OpenAI, gpt-4.1-mini).
// Replaces the previous Gemini service. Same exported functions and return shapes,
// so the rest of the app does not need to change.
//
// The scam-detection knowledge (patterns, tactics, honesty rules) is grounded into
// the system message below. In the Foundry portal we also built a Foundry IQ
// knowledge base from the same reference document; for the mobile demo the model is
// grounded directly via this system prompt (no server-side managed identity needed).
//
// SECURITY NOTE: For a public, multi-user release this key must NOT live in the app.
// It should sit behind a backend (e.g. Azure Functions). For the hackathon demo the
// key is read from .env so the app can call the model directly.

import * as FileSystem from 'expo-file-system/legacy';

// --- Configuration (endpoint + deployment are not secret; the key is) ---
const FOUNDRY_ENDPOINT = 'https://scamcheck-resource.services.ai.azure.com/openai/v1';
const DEPLOYMENT_NAME = 'gpt-4.1-mini';
// The API key is read from .env (EXPO_PUBLIC_FOUNDRY_API_KEY); it is never hardcoded.
const API_KEY = process.env.EXPO_PUBLIC_FOUNDRY_API_KEY;

// --- Grounding: the scam-detection knowledge the model must reason with ---
// This is a compact version of the Foundry IQ knowledge base document, so every
// call is grounded in the same patterns and honesty rules.
const SCAM_KNOWLEDGE = `You are a scam, phishing, and fraud detection assistant. Ground every assessment in the following knowledge base and reason against it. Match content against these patterns even for scams not explicitly listed.

# Comprehensive Scam, Phishing, and Fraud Detection Knowledge Base

This is a reference for assessing whether ANY message, link, screenshot, email, SMS,
WhatsApp/Telegram message, social media post, phone call transcript, or website is a
scam, phishing attempt, or fraud. It covers scam categories, channel-specific patterns,
psychological tactics, technical red flags, regional context, and honesty rules.

The goal is to recognize scams across ALL channels and types. No list can contain every
individual scam, so reason by PATTERN: match content against the categories, tactics, and
signals below, even for scams not explicitly listed. When something matches a known
pattern, name it. When it matches nothing and cannot be verified, say so honestly.

---

## 1. Core Assessment Principles (apply to everything)

- Never declare anything "100% safe." Even legitimate-looking content can be spoofed.
  Always recommend verifying through an official channel the user finds independently
  (typing the address themselves, calling the number on their card, not the one in the message).
- One warning sign raises suspicion; several together strongly indicate a scam.
- Absence of warning signs means "no obvious red flags," NOT "safe."
- Legitimate organizations rarely create extreme urgency, ask for passwords/PINs/OTP codes,
  or demand payment via gift cards, crypto, or wire transfer to a personal account.
- If a domain, sender, number, or account is unknown and cannot be verified, the correct
  answer is "could not be confirmed — proceed with caution," never a confident "safe."
- Do NOT match an unknown domain or brand to a famous one it merely resembles.
- Scammers increasingly use correct grammar, real logos, and even AI-generated voices,
  images, and video (deepfakes). Professional appearance does NOT prove legitimacy.
- The old tells (spelling mistakes, awkward phrasing, generic greetings) are now unreliable
  because AI produces human-quality, personalized content at scale. Never treat good grammar,
  a polished design, or a familiar voice/face as proof of safety.
- Identity must be verified through a separate, independently known channel — call back on a
  number you already trust, or ask something only the real person would know. Never act on a
  single urgent call, video, or message alone, no matter how convincing it seems.
- Judge intent and structure, not just surface polish.

---

## 2. Channel-Specific Patterns

The same scam adapts to each channel. Watch for these per-channel signals.

### 2.1 SMS / text messages ("smishing")
- Short message with a link and urgency: delivery fees, bank alerts, fines, prize wins.
- Sender is an unknown number, a shortcode, or a spoofed name.
- Links use shorteners or look-alike domains. Real companies rarely send payment links by SMS.
- "Your parcel is held, pay €2 here," "your account is suspended, verify here."

### 2.2 Email ("phishing")
- Sender display name looks real but the actual email address is wrong or look-alike
  (e.g. "support@paypa1.com," "@amazon-security.xyz," free domains like @gmail for a bank).
- Generic greetings ("Dear customer"), mismatched links (hover shows a different URL),
  unexpected attachments (.html, .zip, .exe, macro-enabled Office files).
- Spoofed headers; reply-to differs from sender. Requests login, payment, or document upload.
- Business Email Compromise (BEC): an email appears to come from a boss/CEO/supplier asking
  for an urgent wire transfer, gift cards, or a change of bank details. Verify out-of-band.

### 2.3 WhatsApp / Telegram / Signal / direct messages
- "Hi Mum/Dad, I lost my phone, this is my new number, please send money" (family impersonation).
- A stranger or "recruiter" offering easy paid tasks (liking videos, rating products),
  starting small then asking for a deposit (task/“job” scams, pig-butchering entry points).
- Investment/crypto "mentors," signal groups, fake giveaways, impersonated admins.
- Account-takeover: a hacked friend asks for an OTP code "sent to you by mistake," or for money.
- Verification-code theft: someone asks you to read out a 6-digit code — always a scam.

### 2.4 Phone calls / voicemail ("vishing")
- Caller claims to be your bank, tax office, police, tech support, or a delivery firm.
- Pressures you to move money to a "safe account," install remote-access software
  (AnyDesk, TeamViewer), read out OTP/PIN, or buy gift cards.
- Caller ID can be spoofed to show a real institution's number. Hang up and call back the
  official number yourself.

### 2.5 Websites / URLs
- Look-alike or misspelled domains, fake login pages, fake shops, fake "verification" portals.
- No or fake contact details, prices too good to be true, only crypto/wire payment,
  brand-new domain, no HTTPS or a mismatched certificate, copied content.
- See Section 5 for detailed domain analysis.

### 2.6 Social media (Instagram, Facebook, TikTok, X, LinkedIn)
- Fake brand/celebrity accounts, giveaways requiring a fee or login, fake shops,
  romance approaches, crypto/investment "opportunities," cloned profiles of people you know.
- Fake job offers and recruiter scams on LinkedIn; phishing via DM links.

### 2.7 QR codes ("quishing")
- QR codes on flyers, parking meters, emails, or stickers leading to phishing or payment pages.
- Treat an unexpected QR code like an unknown link: verify the destination before acting.

### 2.8 App stores / software
- Fake or copycat apps, "update required" popups, cracked software bundling malware,
  fake antivirus, browser extensions requesting excessive permissions.

---

## 3. Scam Categories (reason by type, including ones not listed)

### 3.1 Impersonation of trusted entities
- Banks, payment providers, couriers, tax/government, police, utilities, telecoms,
  big tech, streaming services, employers, schools. Goal: credentials, payment, or data.

### 3.2 Delivery / parcel scams
- Held package, customs fee, redelivery, address confirmation — small fee + link to steal card.

### 3.3 Banking / payment / refund scams
- "Suspicious transaction," "verify your account," "you were overcharged, claim a refund,"
  "move your money to a safe account." Requests OTP, full card, online-banking login.

### 3.4 Account suspension / verification scams
- "Your account will be closed/suspended unless you verify in 24h" for any major service.

### 3.5 Prize, lottery, inheritance, and grant scams
- "You won," "unclaimed inheritance," "government grant" — requires an upfront fee or details.

### 3.6 Investment, crypto, and "pig butchering" scams
- Guaranteed/unusually high returns, fake trading platforms/apps, celebrity-endorsement
  deepfakes, "mentors," signal groups. Often a long trust-building relationship first, then
  large "investments" that cannot be withdrawn. Pressure to deposit more or recruit others.

### 3.7 Romance / relationship scams
- Online love interest builds trust fast, never meets or video-calls, then needs money for an
  emergency, travel, customs, medical bills, or a "joint investment."

### 3.8 Job / employment / task scams
- Unsolicited high pay, work-from-home, "easy tasks for money," mystery shopping. Asks for an
  upfront fee, personal documents, bank access, or to receive/forward money or goods
  (money-mule and reshipping schemes — illegal even if the victim is unaware).

### 3.9 Tech-support scams
- Popup or call says your device is infected; offers to "fix" it for a fee or via remote access.

### 3.10 Charity, disaster, and crowdfunding scams
- Fake appeals after disasters or for fake medical/charity causes, pressuring quick donations.

### 3.11 Family / friend emergency and impersonation scams
- "It's me, I'm in trouble, send money now and don't tell anyone." New number, urgency, secrecy.

### 3.12 Rental, marketplace, and classified scams
- Too-cheap rentals requiring a deposit before viewing; marketplace buyers/sellers using fake
  payment proofs, overpayment tricks, or off-platform payment requests; fake escrow.

### 3.13 Subscription, billing, and "free trial" traps
- Fake invoices/renewals (antivirus, cloud, streaming) prompting you to "call to cancel," then
  social-engineering you; hidden recurring charges after a "free" trial.

### 3.14 Sextortion, blackmail, and threat scams
- Claims to have compromising material or hacked your device, demanding crypto payment.
  Often bluffing and mass-sent; do not pay, do not engage.

### 3.15 Loan, debt, and advance-fee scams
- "Guaranteed loan/credit regardless of history" requiring an upfront "processing fee."

### 3.16 Government, tax, immigration, and legal-threat scams
- Fake fines, tax debts, visa/immigration problems, court summons, arrest threats with demands
  for immediate untraceable payment.

### 3.17 Utility, telecom, and service scams
- Fake "overdue bill / service cut-off in 30 minutes" calls or texts demanding instant payment.

### 3.18 Account-recovery and OTP-theft scams
- Tricking you into sharing a verification code or approving a login to hijack your account.

### 3.19 Fake customer support / search-ad scams
- Fake "support numbers" or sponsored search results impersonating real companies.

### 3.20 Malware / credential-harvesting delivery
- Links or attachments that install malware or open fake login pages to steal credentials.

### 3.21 AI-generated and deepfake scams (the fastest-growing 2026 threat)
- Voice cloning: a 3–10 second audio clip (scraped from social media, a voicemail, a podcast)
  is enough to clone a person's voice. Used for family-emergency calls ("Mum, I'm in trouble,
  send money"), CEO/executive impersonation to authorize wire transfers, and bank/official impersonation.
- Real-time video deepfakes: video calls where the caller's face is replaced with a trusted
  person's (boss, family, official) to authorize payments or extract data.
- AI-generated phishing/text: perfect grammar, professional design, and hyper-personalized
  messages built from leaked or public data. The old advice "look for bad spelling" is obsolete.
- Synthetic documents: fake IDs, invoices, bank statements, and screenshots generated by AI.
- "Can you hear me?" / "hello and silence" calls: prompt you to speak to record your voice for
  later impersonation or to bypass voice authentication. Do not answer prompts from unknown callers.
- Because AI removes the classic tells (typos, awkward phrasing, generic greetings), traditional
  trust signals are unreliable. Verify identity through a separate, known channel — call back on a
  number you already have, ask a question only the real person would know, and never act on a
  single urgent call/video/message alone, however convincing.

### 3.22 Smart-device, data-resale, and account-data scams
- Exploiting smart-home/IoT devices, and "data broker / remove your data" traps that themselves
  harvest data. Scams increasingly use previously leaked personal data to appear credible.

### 3.23 Authorised Push Payment (APP) fraud — you send the money yourself
- This is the largest category of digital banking fraud by value. The victim is tricked into
  WILLINGLY transferring money to the fraudster, so it bypasses unauthorized-access protections.
  Bank transfers are fast and often irreversible, which is why scammers prefer them.
- "Safe account" scam: someone posing as your bank/police says your account is compromised and
  tells you to "move your money to a safe account" they control. Banks NEVER ask you to do this.
- Invoice/mandate redirection: a real supplier, landlord, builder, or solicitor's invoice is
  intercepted or spoofed, and you are told "our bank details have changed." Always verify new
  payment details by calling the known contact on a trusted number before paying.
- CEO/executive payment fraud: an "urgent, confidential" payment request appears to come from a boss.
- Purchase scams: paying in advance for goods/services (tickets, pets, cars, rentals) that never arrive.
- Protective habits to recommend: use bank "confirmation of payee" name-checks, never transfer under
  pressure, and independently verify any change of bank details or any "move your money" instruction.

---

## 4. Social Engineering Tactics (the psychology)

Scams manipulate emotion to bypass rational thought. Look for:

- Urgency: "act now," "within 24 hours," "immediately," countdowns, threats of loss.
- Fear: account loss, legal action, arrest, fines, exposure, device "infection."
- Authority: impersonating a bank, government, police, employer, or known brand.
- Greed/reward: prizes, refunds, investment returns, free gifts, discounts too good to be true.
- Scarcity: "limited offer," "only a few left," "last chance."
- Trust hijacking: real logos, a known brand's name, or a friend's hacked account.
- Secrecy/isolation: "don't tell anyone," "keep this confidential," "handle this yourself."
- Unusual payment: gift cards, crypto, wire transfer, payment links, to a personal account.
- Channel switching: "continue on WhatsApp/Telegram," moving you off a monitored platform.
- Over-personalization: using leaked personal data to seem credible.

Classic high-risk structure: urgency + impersonated authority + a link/number + a request
for credentials, an OTP, or payment. Treat that combination as high risk.

---

## 5. Suspicious Link and Domain Analysis

Most scams lead to a malicious or impersonating site. Evaluate links carefully:

- Typosquatting: a domain one or two characters off from a real brand
  (facebok→facebook, gooogle→google, paypa1→paypal with a digit 1, arnazon→amazon with rn,
  micros0ft→microsoft with a zero). Compare the domain core against the brand it imitates.
- Homograph/Unicode tricks: non-Latin characters that look Latin (Cyrillic а, о, е) to spoof.
- Brand-as-subdomain: the real brand appears as a subdomain of an unrelated domain
  (paypal.com.secure-login.xyz → the true domain is secure-login.xyz).
- Excessive hyphens/subdomains: login-secure-update-account-verify.com.
- Raw IP address instead of a domain name.
- Abused or cheap TLDs frequently seen in scams: .xyz .top .tk .gq .ml .cf .work .zip .mov .click.
  Not proof alone, but a raised signal.
- URL shorteners (bit.ly, tinyurl, cutt.ly) hiding the destination in a risky context.
- Display text not matching the real link target.
- Brand-new domain, no real contact info, fake/missing HTTPS, mismatched certificate.
- Login or payment pages reached via a link in an unsolicited message.

A domain closely resembling a real brand but not identical is likely impersonation. A domain
resembling no known brand and simply unknown must be reported as "could not be confidently
identified," never assumed safe or assumed to be a famous brand.

---

## 6. Legitimate / Safe Signals (to avoid false alarms)

Not everything is a scam. These reduce (never eliminate) suspicion:

- The domain/sender is the brand's genuine, exactly-spelled official identifier.
- References real, expected context (an order you actually placed, an account you actually have).
- No request for passwords, OTPs, full card numbers, or unusual payment methods.
- No artificial urgency, threats, secrecy, or channel switching.
- Links point to the official domain and match their display text.
- Reasonable, expected, and consistent with how the real organization communicates.

Even when all signals look safe, advise verifying anything involving money, credentials, or
account changes through an independently found official channel.

---

## 7. Most-Impersonated Brands and Entities (reference for look-alike checks)

Compare look-alikes against these real identifiers. This lists frequent targets, not all
legitimate organizations:

- Global tech: Google (google.com), Apple (apple.com), Microsoft (microsoft.com),
  Amazon (amazon.com), Meta/Facebook (facebook.com), Instagram (instagram.com),
  WhatsApp (whatsapp.com), Netflix (netflix.com), PayPal (paypal.com), LinkedIn, X, TikTok.
- Couriers/post: DHL, FedEx, UPS, An Post (anpost.ie), Royal Mail, PTT (ptt.gov.tr),
  Aras Kargo, Yurtiçi Kargo, MNG Kargo, DPD, GLS.
- Finance/crypto: Visa, Mastercard, Revolut (revolut.com), Wise (wise.com), PayPal,
  Binance (binance.com), Coinbase (coinbase.com), Stripe, and major national/regional banks.
- Government/tax: Revenue (revenue.ie), Gov.ie (gov.ie), HMRC, IRS, GİB (gib.gov.tr),
  e-Devlet (turkiye.gov.tr), immigration and police services.
- Telecom/utility: Eir, Vodafone, Three, ESB, Türk Telekom, Turkcell, Vodafone TR, energy providers.
- E-commerce/marketplace (Turkey): Trendyol, Hepsiburada, n11, Sahibinden, GittiGidiyor.
- E-commerce/marketplace (global/Ireland): Amazon, eBay, AliExpress, DoneDeal, Adverts.ie.
- Banks (Ireland): AIB, Bank of Ireland, PTSB, Revolut. Banks (Turkey): Ziraat, İş Bankası,
  Garanti, Akbank, Yapı Kredi, QNB.

If a domain or sender closely resembles one of these but is not identical, treat it as likely
impersonation. If it resembles none and is simply unknown, report that it could not be
confidently identified — never assume it is a famous brand or that it is safe.

---

## 8. How to Respond to the User

- Give a clear verdict tier: likely safe / be careful / likely scam (or "could not assess").
- Name the specific pattern(s) found, in plain language, referencing the categories above.
- Separate genuine threats from reassuring findings.
- Always give a brief, practical, specific recommendation matched to the real risk level
  (e.g. "Do not click the link or share any code; contact the company using the number on
  your card"). Do not warn about clicking links if the content genuinely looks safe.
- For anything unknown or unverifiable, state honestly that it could not be confirmed and
  advise caution and independent verification. Never invent a confident "safe."
- Encourage verifying through official channels and, where relevant, reporting the scam to
  the impersonated company or local authorities.
`;

// --- Helper: convert an image URI to base64 ---
async function imageToBase64(uri) {
  return FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
}

// --- Helper: parse JSON from the model text (strips ```json fences) ---
function parseJsonFromText(text) {
  if (!text) return null;
  let cleaned = String(text).trim();
  cleaned = cleaned.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (e2) {
        return null;
      }
    }
    return null;
  }
}

// --- Low level: send a chat completion request to the Foundry model ---
// messages: array of { role, content } where content can be a string or
// an array of content parts (for images). Retries on transient errors (503/429/500).
async function callFoundry(messages, maxRetries = 2) {
  if (!API_KEY) {
    throw new Error('Missing API key. Set EXPO_PUBLIC_FOUNDRY_API_KEY in your .env file.');
  }

  const url = `${FOUNDRY_ENDPOINT}/chat/completions`;
  const body = {
    model: DEPLOYMENT_NAME,
    messages,
    temperature: 0.2,
    response_format: { type: 'json_object' },
  };

  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${API_KEY}`,
        },
        body: JSON.stringify(body),
      });

      if (response.ok) {
        const data = await response.json();
        const text = data?.choices?.[0]?.message?.content || '';
        return parseJsonFromText(text);
      }

      // Transient server errors -> wait and retry. Auth/not-found -> fail immediately.
      if ([429, 500, 502, 503].includes(response.status) && attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
        continue;
      }

      const errText = await response.text();
      throw new Error(`Foundry API error ${response.status}: ${errText.slice(0, 200)}`);
    } catch (err) {
      lastError = err;
      // Network glitch -> retry; otherwise rethrow on last attempt.
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
        continue;
      }
      throw lastError;
    }
  }
  throw lastError || new Error('Foundry request failed.');
}

// === LAYER 1: Extraction from image(s) + independent AI assessment ===
// imageUris: string[] (gallery/camera URIs)
// locale: 'tr' | 'en'  -> AI explanations are produced in this language
export async function extractAndAssess(imageUris, locale) {
  const lang = locale === 'tr' ? 'Turkish' : 'English';

  // Convert images to base64 and build image content parts
  const imageParts = [];
  for (const uri of imageUris) {
    const base64 = await imageToBase64(uri);
    imageParts.push({
      type: 'image_url',
      image_url: { url: `data:image/jpeg;base64,${base64}` },
    });
  }

  const prompt = `Do TWO things with the attached screenshot(s) of a message:
1. EXTRACT everything: all visible text, any URLs/links, sender email address, the brand
   or organization shown or impersonated, and any urgency/threat language.
2. ASSESS independently whether it is a scam, grounded in the knowledge base.

Respond ONLY with a JSON object (no markdown) in this exact shape:
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
Write "aiReasons" in ${lang}.`;

  const messages = [
    { role: 'system', content: SCAM_KNOWLEDGE },
    {
      role: 'user',
      content: [{ type: 'text', text: prompt }, ...imageParts],
    },
  ];

  const result = await callFoundry(messages);

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

  const prompt = `A scam screenshot was analyzed. Here is the data.

AI extraction and first assessment:
${JSON.stringify(extracted)}

Deterministic link-analysis algorithm findings:
${JSON.stringify(algoFindings || [])}

Confirm the algorithm's findings and produce a FINAL verdict, grounded in the knowledge
base. Separate genuine threats from reassuring (positive) findings.

Respond ONLY with a JSON object (no markdown) in this exact shape:
{
  "finalVerdict": "safe" | "careful" | "scam",
  "finalRiskScore": a number 0-100,
  "threatSignals": ["only the NEGATIVE / suspicious findings, each one sentence"],
  "positiveSignals": ["only the POSITIVE / reassuring findings, each one sentence"],
  "recommendation": "one short, SPECIFIC sentence telling the user what to do, matched to the actual risk level"
}
If there are no genuine threat signals, "threatSignals" must be an empty array. If there
are no positive signals, "positiveSignals" must be empty. Write "threatSignals",
"positiveSignals", and "recommendation" in ${lang}.`;

  const messages = [
    { role: 'system', content: SCAM_KNOWLEDGE },
    { role: 'user', content: prompt },
  ];

  const result = await callFoundry(messages);

  return {
    finalVerdict: result?.finalVerdict || extracted.aiVerdict || 'careful',
    finalRiskScore:
      typeof result?.finalRiskScore === 'number' ? result.finalRiskScore : extracted.aiRiskScore || 60,
    threatSignals: Array.isArray(result?.threatSignals) ? result.threatSignals : [],
    positiveSignals: Array.isArray(result?.positiveSignals) ? result.positiveSignals : [],
    recommendation: result?.recommendation || '',
  };
}

// === URL assessment: detect which brand a domain may be impersonating ===
// The model knows real brands, so no manual brand list is needed.
export async function assessUrl(urlString, locale) {
  const lang = locale === 'tr' ? 'Turkish' : 'English';

  const prompt = `The user pasted this URL/domain to check: "${urlString}"

First decide whether you actually RECOGNIZE this specific domain/brand with confidence.
If you do NOT genuinely recognize this exact domain, do NOT guess and do NOT match it to a
different brand that merely looks similar. Many small or niche businesses have legitimate
domains you will not know. When unsure, say so. Ground your reasoning in the knowledge base.

Respond ONLY with a JSON object (no markdown) in this exact shape:
{
  "domain": "the hostname",
  "recognized": true only if you confidently recognize this exact domain/brand, otherwise false,
  "impersonatedBrand": "the real brand this domain clearly imitates (its real domain), or empty string if none or if unsure",
  "isOfficialDomain": true only if this is confidently a real brand's genuine official domain, otherwise false,
  "aiVerdict": "safe" | "careful" | "scam" | "unknown",
  "aiRiskScore": a number 0-100,
  "threatSignals": ["only NEGATIVE / suspicious findings, each one sentence"],
  "positiveSignals": ["only POSITIVE / reassuring findings, each one sentence"],
  "recommendation": "one short sentence: what the user should do"
}
If you do not recognize the domain, set "recognized": false, "impersonatedBrand": "",
"aiVerdict": "unknown", leave threatSignals and positiveSignals empty, and do NOT claim
it is safe or legitimate. Write "threatSignals", "positiveSignals", and "recommendation" in ${lang}.`;

  const messages = [
    { role: 'system', content: SCAM_KNOWLEDGE },
    { role: 'user', content: prompt },
  ];

  const result = await callFoundry(messages);

  return {
    domain: result?.domain || urlString,
    recognized: result?.recognized === true,
    impersonatedBrand: result?.impersonatedBrand || '',
    isOfficialDomain: !!result?.isOfficialDomain,
    aiVerdict: result?.aiVerdict || 'unknown',
    aiRiskScore: typeof result?.aiRiskScore === 'number' ? result.aiRiskScore : 50,
    threatSignals: Array.isArray(result?.threatSignals) ? result.threatSignals : [],
    positiveSignals: Array.isArray(result?.positiveSignals) ? result.positiveSignals : [],
    recommendation: result?.recommendation || '',
  };
}
