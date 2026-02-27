// src/offscreen/offscreen.js

const PROVIDERS = [
  // Tier 1: Primary (Unlimited/High Limit) - Safe for 1s cadence
  { url: "https://api.ipify.org?format=json", tier: 1 },
  { url: "https://api64.ipify.org?format=json", tier: 1 },
  // Tier 2: Fallback (Unknown Limits, use with caution/backoff)
  { url: "https://checkip.amazonaws.com/", tier: 2 },
  { url: "https://ident.me/", tier: 2 },
  // Tier 3: Manual Only (Strict Limits) - Never use in auto heartbeat
  { url: "https://ifconfig.co/ip", tier: 3 },
  { url: "https://ipinfo.io/ip", tier: 3 }
];

// Configuration
const CHECK_INTERVAL = 1000;
const TIMEOUT_MS = 1500; // Reduced to 1.5s for faster failover
const TIER2_BACKOFF = 5000; // Only retry Tier 2 every 5s if Tier 1 fails

// State
let isChecking = false;
let checkTimer = null;
let providerHealth = {}; // { url: { failures: 0, lastSuccess: 0, cooldownUntil: 0 } }
let lastTier2Check = 0;

// --- Message Listener ---
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "FORCE_CHECK") {
        if (!isChecking) {
             if (checkTimer) clearTimeout(checkTimer);
             checkIpLoop(true); // Force include Tier 3
        }
    }
    sendResponse({ received: true });
    return false; // Sync
});

// --- Main Loop ---

async function checkIpLoop(force = false) {
  if (isChecking && !force) return;
  isChecking = true;

  try {
    const result = await fetchIpWithStrategy(force);

    if (result) {
      chrome.runtime.sendMessage({
        type: "IP_UPDATE",
        ip: result.ip,
        provider: result.provider,
        timestamp: Date.now()
      }).catch(() => {});
    } else {
      chrome.runtime.sendMessage({
        type: "IP_CHECK_FAILED",
        timestamp: Date.now()
      }).catch(() => {});
    }
  } catch (e) {
    console.error("Critical error in IP loop:", e);
  } finally {
    isChecking = false;
    checkTimer = setTimeout(checkIpLoop, CHECK_INTERVAL);
  }
}

// Start immediately
checkIpLoop(false);

// --- IP Fetching Logic ---

async function fetchIpWithStrategy(force) {
  const now = Date.now();

  // Define allowed tiers: Tier 3 is ONLY allowed if 'force' is true
  const allowedTiers = force ? [1, 2, 3] : [1, 2];

  // Filter providers
  let candidates = PROVIDERS.filter(p => allowedTiers.includes(p.tier));

  // Filter out unhealthy/cooldown
  candidates = candidates.filter(p => {
      const h = providerHealth[p.url];
      if (!h) return true;
      // Allow retry if cooldown expired OR force mode
      if (force) return true;
      return now > (h.cooldownUntil || 0);
  });

  // Sort
  candidates.sort((a, b) => {
    const hA = providerHealth[a.url] || { failures: 0, lastSuccess: 0 };
    const hB = providerHealth[b.url] || { failures: 0, lastSuccess: 0 };

    // Tier 1 always first unless failed recently
    if (a.tier !== b.tier) return a.tier - b.tier;

    // Then Health (failures asc)
    if (hA.failures !== hB.failures) return hA.failures - hB.failures;

    // Then Recency (desc)
    return hB.lastSuccess - hA.lastSuccess;
  });

  // If Force, implement parallel race for first 2 candidates (latency optimization)
  if (force && candidates.length >= 2) {
      try {
          const raceCandidates = candidates.slice(0, 2);
          const promises = raceCandidates.map(p =>
              fetchIpWithTimeout(p.url).then(ip => ({ip, provider: p.url}))
          );

          const result = await Promise.any(promises);
          if (result) {
               updateHealth(result.provider, true);
               return result;
          }
      } catch (e) {
          // Both failed, fall through to sequential
      }
  }

  // Sequential Fallback
  for (const p of candidates) {
    // If Tier 2, check strict backoff unless FORCE
    if (p.tier === 2 && !force) {
        if (now - lastTier2Check < TIER2_BACKOFF) continue;
        lastTier2Check = now;
    }

    try {
      const ip = await fetchIpWithTimeout(p.url);
      if (ip) {
        updateHealth(p.url, true);
        return { ip, provider: p.url };
      }
    } catch (e) {
      updateHealth(p.url, false);
    }
  }
  return null;
}

function updateHealth(url, success) {
    if (!providerHealth[url]) providerHealth[url] = { failures: 0, lastSuccess: 0, cooldownUntil: 0 };

    if (success) {
        providerHealth[url].failures = 0;
        providerHealth[url].lastSuccess = Date.now();
        providerHealth[url].cooldownUntil = 0;
    } else {
        providerHealth[url].failures++;
        // Simple backoff: 5s * failures (max 30s)
        const backoff = Math.min(30000, 5000 * providerHealth[url].failures);
        providerHealth[url].cooldownUntil = Date.now() + backoff;
    }
}

function fetchIpWithTimeout(url) {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const id = setTimeout(() => {
        controller.abort();
        reject(new Error("Timeout"));
    }, TIMEOUT_MS);

    fetch(url, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const contentType = response.headers.get("content-type");
        let ip = "";

        if (contentType && contentType.includes("application/json")) {
            const json = await response.json();
            ip = json.ip || json.query || json.origin || "";
        } else {
            const text = await response.text();
            ip = text;
        }
        return ip ? ip.trim() : "";
      })
      .then(ip => {
        clearTimeout(id);
        if (isValidIp(ip)) resolve(ip);
        else reject(new Error("Invalid IP: " + ip));
      })
      .catch(err => {
        clearTimeout(id);
        reject(err);
      });
  });
}

function isValidIp(ip) {
  if (!ip) return false;
  // Basic IPv4
  if (/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(ip)) return true;
  // IPv6 (simple check)
  if (ip.includes(":") && /^[a-fA-F0-9:]+$/.test(ip)) return true;
  return false;
}
