// utils/linkAnalyzer.js
// Pure JavaScript link analysis — not AI. Deterministic checks at the character level.
// Goal: catch fake domains (e.g. govv.ie vs gov.ie) mathematically.

// --- Levenshtein distance: number of character edits between two strings ---
export function levenshtein(a, b) {
  a = (a || '').toLowerCase();
  b = (b || '').toLowerCase();
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}

// --- Parse a string as a URL and extract the hostname ---
function getHost(urlString) {
  if (!urlString) return '';
  let s = String(urlString).trim();
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  try {
    return new URL(s).hostname.toLowerCase();
  } catch {
    // Fallback rough cleanup if parsing fails
    return String(urlString).toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
  }
}

// --- Extract the "core" of a domain (e.g. login.paypal-secure.com -> paypal-secure) ---
function coreDomain(host) {
  const parts = host.split('.').filter(Boolean);
  if (parts.length >= 2) {
    return parts[parts.length - 2]; // SLD
  }
  return host;
}

// --- Homograph / Unicode trick: any non-ASCII (non-Latin) characters? ---
function hasNonAsciiTrick(host) {
  // If not pure ASCII (e.g. Cyrillic 'а' used as a fake letter), treat as suspicious
  return /[^\u0000-\u007F]/.test(host) || host.includes('xn--');
}

// --- Analyze a single URL ---
// brandName: the brand name Gemini detected in the message (used for typosquatting comparison)
export function analyzeUrl(urlString, brandName, locale) {
  const tr = locale === 'tr';
  const host = getHost(urlString);
  const core = coreDomain(host);
  const signals = [];
  let riskPoints = 0;

  // 1) Homograph / Unicode trick
  if (hasNonAsciiTrick(host)) {
    riskPoints += 35;
    signals.push(
      tr
        ? `Alan adında Latin olmayan/sahte karakter olabilir: ${host}`
        : `Domain may contain non-Latin/fake characters: ${host}`
    );
  }

  // 2) Typosquatting: very similar to the brand name but not identical
  if (brandName) {
    // If the brand is a domain (gov.ie), take its core too (gov);
    // otherwise strip non-alphanumerics. Normalize both sides the same way.
    const brandHasDot = brandName.includes('.');
    const brandCoreRaw = brandHasDot ? coreDomain(brandName.toLowerCase()) : brandName.toLowerCase();
    const brandCore = brandCoreRaw.replace(/[^a-z0-9]/g, '');
    const cleanCore = core.replace(/[^a-z0-9]/g, '');

    if (brandCore && cleanCore && brandCore !== cleanCore) {
      const dist = levenshtein(brandCore, cleanCore);
      // Very similar but not identical (1-2 char difference) -> classic typosquat
      if (dist >= 1 && dist <= 2 && Math.abs(brandCore.length - cleanCore.length) <= 2) {
        riskPoints += 40;
        signals.push(
          tr
            ? `"${host}" alan adı "${brandName}" markasına çok benziyor ama birebir değil (sahte olabilir).`
            : `"${host}" closely resembles brand "${brandName}" but is not identical (possible fake).`
        );
      }
      // Brand name appears in the link but the real domain core differs (paypal.com.evil.xyz)
      else if (host.includes(brandCore) && cleanCore !== brandCore) {
        riskPoints += 25;
        signals.push(
          tr
            ? `Marka adı "${brandName}" bağlantıda geçiyor ama asıl alan adı farklı.`
            : `Brand "${brandName}" appears in the link but the real domain differs.`
        );
      }
    }
  }

  // 3) Suspicious structure: too many subdomains / hyphens
  const dotCount = (host.match(/\./g) || []).length;
  if (dotCount >= 3) {
    riskPoints += 12;
    signals.push(tr ? 'Çok fazla alt alan adı katmanı var.' : 'Unusually many subdomain levels.');
  }
  if ((core.match(/-/g) || []).length >= 2) {
    riskPoints += 10;
    signals.push(tr ? 'Alan adında çok sayıda tire var.' : 'Multiple hyphens in the domain name.');
  }

  // 4) IP address link
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host)) {
    riskPoints += 25;
    signals.push(tr ? 'Alan adı yerine ham IP adresi kullanılmış.' : 'Raw IP address used instead of a domain.');
  }

  // 5) Suspicious top-level domain
  const badTlds = ['.xyz', '.top', '.click', '.zip', '.review', '.country', '.kim', '.work'];
  if (badTlds.some((tld) => host.endsWith(tld))) {
    riskPoints += 12;
    signals.push(tr ? 'Dolandırıcılıkta sık kullanılan bir uzantı.' : 'Uses a TLD often abused in scams.');
  }

  // 6) URL shortener
  const shorteners = ['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly'];
  if (shorteners.some((s) => host.endsWith(s))) {
    riskPoints += 15;
    signals.push(tr ? 'Gerçek hedefi gizleyen bir URL kısaltıcı.' : 'A URL shortener that hides the real destination.');
  }

  return {
    url: urlString,
    host,
    signals,
    riskPoints: Math.min(100, riskPoints),
  };
}

// --- Analyze multiple URLs and return an aggregated result ---
export function analyzeUrls(urls, brandName, locale) {
  const tr = locale === 'tr';
  if (!Array.isArray(urls) || urls.length === 0) {
    return {
      findings: [tr ? 'Mesajda bağlantı bulunamadı.' : 'No links found in the message.'],
      maxRisk: 0,
      perUrl: [],
    };
  }

  const perUrl = urls.map((u) => analyzeUrl(u, brandName, locale));
  const findings = [];
  let maxRisk = 0;

  for (const r of perUrl) {
    maxRisk = Math.max(maxRisk, r.riskPoints);
    if (r.signals.length > 0) {
      findings.push(...r.signals);
    }
  }

  if (findings.length === 0) {
    findings.push(
      tr
        ? 'Bağlantılarda belirgin teknik tehlike işareti bulunamadı, yine de dikkatli ol.'
        : 'No obvious technical red flags in the links, but stay cautious.'
    );
  }

  return { findings, maxRisk, perUrl };
}
