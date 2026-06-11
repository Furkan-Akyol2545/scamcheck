// utils/safeBrowsing.js
// Checks a URL against Google Safe Browsing's database of known malicious sites.
// IMPORTANT: this does NOT visit the link. It only asks Google's threat database
// whether the URL is already known to be dangerous, so the user (and the app) never
// touch the suspicious site.
//
// Requires a Google Safe Browsing API key in .env as EXPO_PUBLIC_SAFE_BROWSING_API_KEY.
// If the key is missing or the request fails, the check is skipped gracefully (the rest
// of the analysis still runs) — it never blocks or crashes the app.

const SAFE_BROWSING_KEY = process.env.EXPO_PUBLIC_SAFE_BROWSING_API_KEY;
const ENDPOINT = 'https://safebrowsing.googleapis.com/v4/threatMatches:find';

// Map Google's threat type to a human-readable description.
function describeThreat(type, tr) {
  switch (type) {
    case 'MALWARE':
      return tr
        ? 'Google Safe Browsing bu adresi bilinen ZARARLI YAZILIM (malware) sitesi olarak işaretliyor.'
        : 'Google Safe Browsing flags this address as a known MALWARE site.';
    case 'SOCIAL_ENGINEERING':
      return tr
        ? 'Google Safe Browsing bu adresi bilinen KİMLİK AVI / dolandırıcılık (phishing) sitesi olarak işaretliyor.'
        : 'Google Safe Browsing flags this address as a known PHISHING / social-engineering site.';
    case 'UNWANTED_SOFTWARE':
      return tr
        ? 'Google Safe Browsing bu adresi istenmeyen yazılım dağıtan bir site olarak işaretliyor.'
        : 'Google Safe Browsing flags this address as distributing unwanted software.';
    case 'POTENTIALLY_HARMFUL_APPLICATION':
      return tr
        ? 'Google Safe Browsing bu adresi zararlı olabilecek uygulama dağıtan bir site olarak işaretliyor.'
        : 'Google Safe Browsing flags this address as hosting a potentially harmful application.';
    default:
      return tr
        ? 'Google Safe Browsing bu adresi tehdit listesinde işaretliyor.'
        : 'Google Safe Browsing flags this address on a threat list.';
  }
}

// Returns: { checked: boolean, listed: boolean, signals: string[], threatTypes: string[] }
// - checked=false means the lookup did not run (no key / network error) -> caller ignores it.
// - listed=true means the URL is on a Google threat list (strong danger signal).
export async function checkUrlSafeBrowsing(urlString, locale) {
  const tr = locale === 'tr';

  if (!SAFE_BROWSING_KEY) {
    return { checked: false, listed: false, signals: [], threatTypes: [] };
  }
  if (!urlString || typeof urlString !== 'string') {
    return { checked: false, listed: false, signals: [], threatTypes: [] };
  }

  // Ensure the URL has a scheme; Safe Browsing expects a full URL.
  let url = urlString.trim();
  if (!/^https?:\/\//i.test(url)) {
    url = `http://${url}`;
  }

  const body = {
    client: { clientId: 'scamcheck-app', clientVersion: '1.0.0' },
    threatInfo: {
      threatTypes: [
        'MALWARE',
        'SOCIAL_ENGINEERING',
        'UNWANTED_SOFTWARE',
        'POTENTIALLY_HARMFUL_APPLICATION',
      ],
      platformTypes: ['ANY_PLATFORM'],
      threatEntryTypes: ['URL'],
      threatEntries: [{ url }],
    },
  };

  try {
    const response = await fetch(`${ENDPOINT}?key=${SAFE_BROWSING_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      // Auth/quota/other error -> skip gracefully, don't break the analysis.
      return { checked: false, listed: false, signals: [], threatTypes: [] };
    }

    const data = await response.json();
    // Empty object {} means no matches -> not on any threat list.
    const matches = Array.isArray(data?.matches) ? data.matches : [];
    if (matches.length === 0) {
      return { checked: true, listed: false, signals: [], threatTypes: [] };
    }

    const threatTypes = [...new Set(matches.map((m) => m.threatType).filter(Boolean))];
    const signals = threatTypes.map((t) => describeThreat(t, tr));
    return { checked: true, listed: true, signals, threatTypes };
  } catch (e) {
    // Network failure -> skip gracefully.
    return { checked: false, listed: false, signals: [], threatTypes: [] };
  }
}
