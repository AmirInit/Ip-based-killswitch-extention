// src/offscreen/offscreen.js

const PROVIDERS = {
  ipify: {
    key: "ipify",
    url: "https://api.ipify.org?format=json",
    tier: 1,
    timeoutMs: 1200,
    minIntervalMs: 900,
    manualOnly: false
  },
  ipify64: {
    key: "ipify64",
    url: "https://api64.ipify.org?format=json",
    tier: 1,
    timeoutMs: 1200,
    minIntervalMs: 900,
    manualOnly: false
  },
  aws: {
    key: "aws",
    url: "https://checkip.amazonaws.com/",
    tier: 2,
    timeoutMs: 1400,
    minIntervalMs: 5000,
    manualOnly: false
  },
  ident: {
    key: "ident",
    url: "https://api.ident.me/json",
    tier: 2,
    timeoutMs: 1400,
    minIntervalMs: 5000,
    manualOnly: false
  },
  ifconfig: {
    key: "ifconfig",
    url: "https://ifconfig.co/ip",
    tier: 3,
    timeoutMs: 2000,
    minIntervalMs: 60000,
    manualOnly: true
  },
  ipinfo: {
    key: "ipinfo",
    url: "https://ipinfo.io/ip",
    tier: 3,
    timeoutMs: 2000,
    minIntervalMs: 60000,
    manualOnly: true
  }
};

const PROVIDER_LIST = Object.values(PROVIDERS);

// Configuration
const CHECK_INTERVAL = 1000;
const BASE_BACKOFF_MS = 5000;
const MAX_BACKOFF_MS = 60000;

// State
let isChecking = false;
let checkTimer = null;
const providerHealth = {}; // keyed by provider.key

function getHealth(providerKey) {
  if (!providerHealth[providerKey]) {
    providerHealth[providerKey] = {
      failures: 0,
      lastSuccess: 0,
      lastAttempt: 0,
      unhealthyUntil: 0
    };
  }
  return providerHealth[providerKey];
}

function markSuccess(provider) {
  const health = getHealth(provider.key);
  health.failures = 0;
  health.lastSuccess = Date.now();
  health.unhealthyUntil = 0;
}

function markFailure(provider, errorMeta = {}) {
  const health = getHealth(provider.key);
  health.failures += 1;

  const shouldBackoff = errorMeta.timeout || errorMeta.rateLimited || errorMeta.serverError;
  if (shouldBackoff) {
    const delay = Math.min(BASE_BACKOFF_MS * (2 ** (health.failures - 1)), MAX_BACKOFF_MS);
    health.unhealthyUntil = Date.now() + delay;
  }
}

function canUseProvider(provider, context) {
  const health = getHealth(provider.key);
  const now = Date.now();

  if (provider.manualOnly && !context.manualOnlyTier3) return false;
  if (health.unhealthyUntil > now) return false;
  if ((now - health.lastAttempt) < provider.minIntervalMs) return false;

  return true;
}

function providerComparator(a, b) {
  if (a.tier !== b.tier) return a.tier - b.tier;

  const hA = getHealth(a.key);
  const hB = getHealth(b.key);

  if (hA.failures !== hB.failures) return hA.failures - hB.failures;
  return hB.lastSuccess - hA.lastSuccess;
}

// --- Message Listener (Top Level for Stability) ---
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "FORCE_CHECK") {
    if (!isChecking) {
      if (checkTimer) clearTimeout(checkTimer);
      checkIpLoop({ force: true, reason: msg.reason || "manual" });
    }
  }
  sendResponse({ received: true });
  return false;
});

// --- Main Loop ---

async function checkIpLoop(options = {}) {
  if (isChecking) return;
  isChecking = true;

  const reason = options.reason || "heartbeat";
  const context = {
    manualOnlyTier3: reason === "manual",
    allowSpeculativeParallel: reason === "manual" || reason === "warmup"
  };

  try {
    const result = await fetchIpWithFailover(context);
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
    checkTimer = setTimeout(() => checkIpLoop({ reason: "heartbeat" }), CHECK_INTERVAL);
  }
}

// Start immediately on load
checkIpLoop({ reason: "heartbeat" });

// --- IP Fetching Logic ---

async function fetchIpWithFailover(context = {}) {
  const available = PROVIDER_LIST.filter(p => canUseProvider(p, context)).sort(providerComparator);
  if (available.length === 0) return null;

  const tier1 = available.filter(p => p.tier === 1);
  const tier2 = available.filter(p => p.tier === 2);
  const tier3 = available.filter(p => p.tier === 3);

  const tier1Result = await trySequential(tier1);
  if (tier1Result) return tier1Result;

  if (context.allowSpeculativeParallel && tier2.length >= 2) {
    const fastTier2 = await tryParallelAny(tier2.slice(0, 2));
    if (fastTier2) return fastTier2;
  }

  const tier2Result = await trySequential(tier2);
  if (tier2Result) return tier2Result;

  if (context.manualOnlyTier3) {
    if (context.allowSpeculativeParallel && tier3.length >= 2) {
      const fastTier3 = await tryParallelAny(tier3.slice(0, 2));
      if (fastTier3) return fastTier3;
    }
    return trySequential(tier3);
  }

  return null;
}

async function trySequential(providers) {
  for (const provider of providers) {
    const result = await tryProvider(provider);
    if (result) return result;
  }
  return null;
}

async function tryParallelAny(providers) {
  if (providers.length === 0) return null;

  const controllers = providers.map(() => new AbortController());
  const attempts = providers.map((provider, i) => tryProvider(provider, controllers[i]).then(result => {
    if (!result) throw new Error("Provider failed");
    return result;
  }));

  try {
    const winner = await Promise.any(attempts);
    controllers.forEach(c => c.abort());
    return winner;
  } catch {
    return null;
  }
}

async function tryProvider(provider, externalController) {
  const health = getHealth(provider.key);
  health.lastAttempt = Date.now();

  try {
    const ip = await fetchIpWithTimeout(provider, externalController);
    if (ip) {
      markSuccess(provider);
      return { ip, provider: provider.url };
    }
  } catch (e) {
    markFailure(provider, {
      timeout: e.name === "AbortError" || /timeout/i.test(e.message || ""),
      rateLimited: /HTTP 429/.test(e.message || ""),
      serverError: /HTTP 5\d\d/.test(e.message || "")
    });
  }
  return null;
}

function fetchIpWithTimeout(provider, externalController) {
  return new Promise((resolve, reject) => {
    const controller = externalController || new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
      reject(new Error("Timeout"));
    }, provider.timeoutMs);

    fetch(provider.url, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const contentType = response.headers.get("content-type") || "";
        let ip = "";

        if (contentType.includes("application/json")) {
          const json = await response.json();
          ip = json.ip || json.address || json.query || json.origin || "";
        } else {
          ip = await response.text();
        }

        return ip ? ip.trim() : "";
      })
      .then(ip => {
        clearTimeout(timeoutId);
        if (isValidIp(ip)) resolve(ip);
        else reject(new Error("Invalid IP: " + ip));
      })
      .catch(err => {
        clearTimeout(timeoutId);
        reject(err);
      });
  });
}

function isValidIp(ip) {
  if (!ip) return false;
  if (/^(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(ip)) return true;
  if (ip.includes(":") && /^[a-fA-F0-9:]+$/.test(ip)) return true;
  return false;
}
