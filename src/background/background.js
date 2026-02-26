// src/background/background.js

// Constants
const ALARM_NAME = "ip_check_alarm";
const DEFAULT_IP_API = "https://api.ipify.org?format=json";
const PANIC_MODE_RULE_ID = 999999;
const BLOCK_PAGE_PATH = "blocked/blocked.html";
const OFFSCREEN_PATH = "offscreen/offscreen.html";
const DEFAULT_LEASE_TIMEOUT = 5000; // 5 seconds default

// State
let currentIp = "Unknown";
let currentProvider = "Unknown";
let lastIpCheckTime = 0;
let panicMode = false;
let rules = []; // { id: number (legacy), domain: string, ips: string[] }
let settings = {
  ipApiUrl: DEFAULT_IP_API, // kept for manual fallback/settings display
  webRtcDisabled: true,
  autoClose: false,
  leaseTimeout: DEFAULT_LEASE_TIMEOUT
};

// --- Initialization ---

chrome.runtime.onInstalled.addListener(() => {
  console.log("Extension installed.");
  initialize();
});

chrome.runtime.onStartup.addListener(() => {
  console.log("Extension startup.");
  initialize();
});

function initialize() {
  loadSettings().then(async () => {
    // Start lease monitor
    setInterval(checkLease, 1000);
    // Setup offscreen for IP checking
    await setupOffscreenDocument();
  });
}

// --- Storage & Settings ---

async function loadSettings() {
  const data = await chrome.storage.local.get(["rules", "settings", "panicMode"]);
  rules = data.rules || [];
  settings = { ...settings, ...data.settings };
  panicMode = data.panicMode || false;

  applyWebRtcSetting();

  // Note: We do NOT load cached IP initially for safety.
  // We wait for a fresh check from Offscreen.
  // Until then, lastIpCheckTime is 0, so lease is expired -> BLOCK state.

  await updateDnrRules();
}

// --- Offscreen Management ---

async function setupOffscreenDocument() {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT']
  });

  if (existingContexts.length > 0) {
    return;
  }

  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_PATH,
      reasons: ['BLOBS'], // "BLOBS" is a generic reason often used for keep-alive/workers
      justification: 'High-frequency IP checking for kill switch functionality'
    });
  } catch (e) {
    console.error("Offscreen creation failed:", e);
  }
}

// --- Message Handling (IP Updates) ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "IP_UPDATE") {
    handleIpUpdate(message.ip, message.provider, message.timestamp);
  } else if (message.type === "IP_CHECK_FAILED") {
    console.warn("All IP providers failed!");
    // Do nothing implies lease will expire naturally
  } else if (message.type === "CHECK_IP_NOW") {
    // Forward to offscreen
    chrome.runtime.sendMessage({ type: "FORCE_CHECK" });
    sendResponse({ success: true });
  } else if (message.type === "DIAGNOSE_RULE") {
      // Diagnostic check
      diagnoseRule(message.domain).then(sendResponse);
      return true; // Async
  }
});

async function handleIpUpdate(ip, provider, timestamp) {
  lastIpCheckTime = Date.now(); // Update lease heartbeat
  currentProvider = provider;

  // Normalize
  const newIp = ip.trim();

  if (currentIp !== newIp) {
    console.log(`IP Changed: ${currentIp} -> ${newIp} (via ${provider})`);
    currentIp = newIp;

    // Save to storage
    await chrome.storage.local.set({
      currentIp: newIp,
      currentProvider: provider
    });

    await updateDnrRules();
  } else {
      // Still need to ensure rules are valid if we were previously expired
      // E.g. internet back -> lease renewed -> apply allow rules
      // Optimization: Check if current rules match desired state?
      // For safety, force update if time since last update > X?
      // Actually, updateDnrRules() checks lease status.
      // If we were expired, updateDnrRules() would have removed Allow rules.
      // Now we are valid, we MUST re-run updateDnrRules() to restore them.
      // To avoid spamming, we can check if we *need* to restore.

      // But simpler is safer: always update on heartbeat? No, 1s DNR update is heavy.
      // Better: Check if we are currently "blocked due to expiration" state.
      // But we don't store that state easily.

      // Let's rely on the checkLease() function to handle EXPIRATION.
      // And here we handle RESTORATION.
      // If we are currently "Unknown/Expired", then we MUST update.
      if (currentIp === "Unknown (Lease Expired)") {
          currentIp = newIp;
          await updateDnrRules();
      }

      // Also, if we just renewed the lease, we should ensure rules are active.
      // But if they are already active, DNR update is redundant.
      // Let's assume they are active unless checkLease killed them.
  }
}

// --- Lease Monitor ---

async function checkLease() {
  const now = Date.now();
  const timeout = settings.leaseTimeout || DEFAULT_LEASE_TIMEOUT;
  const isExpired = (now - lastIpCheckTime) > timeout;

  // If expired, force update rules to remove Allows
  if (isExpired && currentIp !== "Unknown (Lease Expired)") {
     console.warn("IP Lease Expired! Reverting to Block.");
     currentIp = "Unknown (Lease Expired)"; // Invalidate IP
     await chrome.storage.local.set({ currentIp: currentIp });
     await updateDnrRules();
  }
}

// --- DNR Rule Management ---

async function updateDnrRules() {
  const extensionId = chrome.runtime.id;
  const newRules = []; // Start fresh

  // 1. Panic Mode Rule
  if (panicMode) {
    newRules.push({
      id: PANIC_MODE_RULE_ID,
      priority: 3,
      action: { type: "block" },
      condition: { urlFilter: "*" }
    });
  }

  // Check Lease
  const now = Date.now();
  const timeout = settings.leaseTimeout || DEFAULT_LEASE_TIMEOUT;
  const isLeaseValid = (now - lastIpCheckTime) < timeout;

  // 2. Domain Rules
  rules.forEach((rule, index) => {
    if (!rule.domain) return;

    let domain = rule.domain.trim();
    domain = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, ""); // Hostname
    if (!domain) return;

    const baseId = index + 1;
    const allowId = index + 10001;

    // A. Base Redirect Rule (Priority 1) - ALWAYS present
    // Redirects main_frame and sub_frame to blocked page
    const regex = `^https?://([a-z0-9-]+\\.)*${escapeRegex(domain)}(/.*)?$`;
    const redirectUrl = `chrome-extension://${extensionId}/${BLOCK_PAGE_PATH}?url=\\0`; // Pass original URL

    newRules.push({
      id: baseId,
      priority: 1,
      action: {
        type: "redirect",
        redirect: { regexSubstitution: redirectUrl }
      },
      condition: {
        regexFilter: regex,
        resourceTypes: ["main_frame", "sub_frame"]
      }
    });

    // B. Allow Rule (Priority 2) - Only if IP matches AND lease is valid AND not panic
    if (!panicMode && isLeaseValid && currentIp && rule.ips && rule.ips.length > 0) {
       // Check against list
       const allowedIps = rule.ips.map(i => i.trim());
       if (allowedIps.includes(currentIp)) {
          newRules.push({
            id: allowId,
            priority: 2,
            action: { type: "allow" },
            condition: {
                regexFilter: regex,
                resourceTypes: ["main_frame", "sub_frame", "stylesheet", "script", "image", "font", "object", "xmlhttprequest", "ping", "csp_report", "media", "websocket", "other"]
            }
          });
       }
    }
  });

  // Apply
  const currentRules = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = currentRules.map(r => r.id);

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: removeRuleIds,
    addRules: newRules
  });
}

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// --- Diagnostics ---

async function diagnoseRule(domain) {
    if (!domain) return { status: "Invalid Domain" };

    const rule = rules.find(r => domain.includes(r.domain) || r.domain.includes(domain));
    const now = Date.now();
    const timeout = settings.leaseTimeout || DEFAULT_LEASE_TIMEOUT;
    const isLeaseValid = (now - lastIpCheckTime) < timeout;

    let status = "Not Found";
    let allowedIps = [];

    if (rule) {
        allowedIps = rule.ips;
        if (panicMode) status = "BLOCKED (Panic)";
        else if (!isLeaseValid) status = "BLOCKED (Lease Expired)";
        else if (allowedIps.includes(currentIp)) status = "ALLOWED";
        else status = "BLOCKED (IP Mismatch)";
    }

    return {
        domain: domain,
        currentIp: currentIp,
        provider: currentProvider,
        status: status,
        allowedIps: allowedIps,
        leaseRemaining: Math.max(0, timeout - (now - lastIpCheckTime))
    };
}

// --- Storage & Settings Listeners ---

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local") {
    let needsUpdate = false;

    if (changes.rules) {
      rules = changes.rules.newValue || [];
      needsUpdate = true;
    }
    if (changes.settings) {
      settings = { ...settings, ...changes.settings.newValue };
      applyWebRtcSetting();
      needsUpdate = true; // Timeout might have changed
    }
    if (changes.panicMode) {
      panicMode = changes.panicMode.newValue;
      needsUpdate = true;
    }

    if (needsUpdate) {
      updateDnrRules();
    }
  }
});

function applyWebRtcSetting() {
  if (!chrome.privacy || !chrome.privacy.network) return;
  const value = settings.webRtcDisabled ? 'disable_non_proxied_udp' : 'default';
  chrome.privacy.network.webRTCIPHandlingPolicy.set({ value: value }, () => {
     if (chrome.runtime.lastError) console.error("WebRTC Error:", chrome.runtime.lastError);
  });
}
