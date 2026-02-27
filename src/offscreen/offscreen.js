// src/offscreen/offscreen.js

const PROVIDERS_TIER_1 = [
  "https://api.ipify.org?format=json",
  "https://api64.ipify.org?format=json"
];

const PROVIDERS_TIER_2 = [
  "https://checkip.amazonaws.com/",
  "https://ident.me.json/" // fallback only
];

const PROVIDERS_TIER_3 = [
  "https://ifconfig.co/ip",
  "https://ipinfo.io/ip"
];

// Configuration
const CHECK_INTERVAL = 1000;
const TIMEOUT_MS = 1500;
const TIER_2_MIN_INTERVAL = 5000; // minimum time between tier 2 attempts

// State
let isChecking = false;
let checkTimer = null;
let providerHealth = {};

// --- Message Listener (Top Level for Stability) ---
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    // Always respond to prevent "Receiving end does not exist"
    if (msg.type === "FORCE_CHECK") {
        if (!isChecking) {
             // Interrupt timer if waiting
             if (checkTimer) clearTimeout(checkTimer);
             checkIpLoop(true);
        }
    }
    sendResponse({ received: true });
    return false; // Sync response
});

// --- Main Loop ---

async function checkIpLoop(force = false) {
  if (isChecking) return;
  isChecking = true;

  try {
    const result = await fetchIpWithFailover(force);
    if (result) {
      chrome.runtime.sendMessage({
        type: "IP_UPDATE",
        ip: result.ip,
        provider: result.provider,
        timestamp: Date.now()
      }).catch(() => {}); // Ignore if background is not listening
    } else {
      // All failed
      chrome.runtime.sendMessage({
        type: "IP_CHECK_FAILED",
        timestamp: Date.now()
      }).catch(() => {});
    }
  } catch (e) {
    console.error("Critical error in IP loop:", e);
  } finally {
    isChecking = false;
    // Schedule next
    checkTimer = setTimeout(checkIpLoop, CHECK_INTERVAL);
  }
}

// Start immediately on load
checkIpLoop(true);

// --- IP Fetching Logic ---

async function fetchIpWithFailover(force) {
  const now = Date.now();

  // Initialize health if needed
  [...PROVIDERS_TIER_1, ...PROVIDERS_TIER_2, ...PROVIDERS_TIER_3].forEach(url => {
    if (!providerHealth[url]) {
      providerHealth[url] = { failures: 0, lastSuccess: 0, cooldownUntil: 0 };
    }
  });

  // Force Check: Parallel Tier 1 Optimization
  if (force) {
    try {
      // Query both Tier 1 simultaneously
      const tier1Promises = PROVIDERS_TIER_1.map(url => fetchIpWithTimeout(url).then(ip => ({ ip, url })));
      // Promise.any resolves with the first successful
      const winner = await Promise.any(tier1Promises);

      providerHealth[winner.url].failures = 0;
      providerHealth[winner.url].lastSuccess = now;
      return { ip: winner.ip, provider: winner.url };
    } catch (e) {
      // Both Tier 1 failed
      PROVIDERS_TIER_1.forEach(url => providerHealth[url].failures++);
    }
  }

  // Define providers to try sequentially based on mode
  let sequence = [];

  if (!force) {
      // Heartbeat: Tier 1 then Tier 2
      sequence = [...PROVIDERS_TIER_1, ...PROVIDERS_TIER_2];
  } else {
      // Force fallback (Tier 1 already failed): Tier 2 then Tier 3
      sequence = [...PROVIDERS_TIER_2, ...PROVIDERS_TIER_3];
  }

  // Sort the sequence primarily by health
  sequence.sort((a, b) => {
    return providerHealth[a].failures - providerHealth[b].failures;
  });

  for (const url of sequence) {
    // Apply Tier 2 cooldowns (except in force mode)
    if (!force && PROVIDERS_TIER_2.includes(url)) {
       if (now < providerHealth[url].cooldownUntil) {
           continue; // Skip this provider
       }
    }

    try {
      const ip = await fetchIpWithTimeout(url);
      if (ip) {
        providerHealth[url].failures = 0;
        providerHealth[url].lastSuccess = now;
        return { ip, provider: url };
      }
    } catch (e) {
      providerHealth[url].failures++;

      // If Tier 2 fails, set cooldown
      if (PROVIDERS_TIER_2.includes(url)) {
          // exponential backoff
          const backoff = TIER_2_MIN_INTERVAL * Math.pow(2, providerHealth[url].failures - 1);
          providerHealth[url].cooldownUntil = now + Math.min(backoff, 60000); // max 60s
      }
    }
  }

  return null;
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
