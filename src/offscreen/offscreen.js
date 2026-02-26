// src/offscreen/offscreen.js

const PROVIDERS = [
  "https://api.ipify.org?format=json",
  "https://api64.ipify.org?format=json",
  "https://ifconfig.co/ip",
  "https://icanhazip.com/",
  "https://checkip.amazonaws.com/",
  "https://ipinfo.io/ip"
];

// Configuration
const CHECK_INTERVAL = 1000;
const TIMEOUT_MS = 2000;

// State
let isChecking = false;
let providerHealth = {}; // { url: { failures: 0, lastSuccess: 0 } }

// --- Main Loop ---

async function checkIpLoop() {
  if (isChecking) return;
  isChecking = true;

  try {
    const result = await fetchIpWithFailover();
    if (result) {
      chrome.runtime.sendMessage({
        type: "IP_UPDATE",
        ip: result.ip,
        provider: result.provider,
        timestamp: Date.now()
      }).catch(() => {});
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
    setTimeout(checkIpLoop, CHECK_INTERVAL);
  }
}

// Start immediately
checkIpLoop();

// --- IP Fetching Logic ---

async function fetchIpWithFailover() {
  const sortedProviders = [...PROVIDERS].sort((a, b) => {
    const healthA = providerHealth[a] || { failures: 0, lastSuccess: 0 };
    const healthB = providerHealth[b] || { failures: 0, lastSuccess: 0 };

    // Primary: Failures (asc)
    if (healthA.failures !== healthB.failures) {
      return healthA.failures - healthB.failures;
    }
    // Secondary: Recency (desc)
    return healthB.lastSuccess - healthA.lastSuccess;
  });

  for (const url of sortedProviders) {
    try {
      const ip = await fetchIpWithTimeout(url);
      if (ip) {
        if (!providerHealth[url]) providerHealth[url] = { failures: 0, lastSuccess: 0 };
        providerHealth[url].failures = 0;
        providerHealth[url].lastSuccess = Date.now();
        return { ip, provider: url };
      }
    } catch (e) {
      if (!providerHealth[url]) providerHealth[url] = { failures: 0, lastSuccess: 0 };
      providerHealth[url].failures++;
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
