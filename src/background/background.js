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
let rules = []; // { id: number, domain: string, ips: string[] }
let settings = {
  ipApiUrl: DEFAULT_IP_API,
  webRtcDisabled: true,
  autoClose: false,
  leaseTimeout: DEFAULT_LEASE_TIMEOUT,
  autoReload: false
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
  setDynamicIcon();
  loadSettings().then(async () => {
    // Start lease monitor
    setInterval(checkLease, 1000);
    // Setup offscreen for IP checking (if needed)
    await setupOffscreenDocument();
  });
}

// --- Storage & Settings ---

async function loadSettings() {
  const data = await chrome.storage.local.get(["rules", "settings", "panicMode"]);
  rules = data.rules || [];
  // Schema Normalization
  rules = rules.map(r => ({ ...r, ips: Array.isArray(r.ips) ? r.ips : [] }));

  settings = { ...settings, ...data.settings };
  panicMode = data.panicMode || false;

  applyWebRtcSetting();
  await updateDnrRules();
}

// --- Offscreen Management ---

async function setupOffscreenDocument() {
  // Only if rules exist
  if (rules.length > 0) {
      const existingContexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT']
      });
      if (existingContexts.length === 0) {
          try {
            await chrome.offscreen.createDocument({
              url: OFFSCREEN_PATH,
              reasons: ['BLOBS'],
              justification: 'High-frequency IP checking for kill switch functionality'
            });
            // Force first check ASAP
            setTimeout(() => safeSendMessage({ type: "FORCE_CHECK" }), 500);
          } catch (e) {
            console.warn("Offscreen creation warning:", e);
          }
      }
  } else {
      // No rules, close offscreen to save resources
      const existingContexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT']
      });
      if (existingContexts.length > 0) {
          try {
              await chrome.offscreen.closeDocument();
          } catch(e) {
              // Ignore if already closed
          }
      }
  }
}

// Helper to safely send message
async function safeSendMessage(message) {
    if (rules.length === 0) return;
    try {
        await chrome.runtime.sendMessage(message);
    } catch (e) {
        // Suppress expected error "Receiving end does not exist"
    }
}

// --- Message Handling (IP Updates) ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "IP_UPDATE") {
    handleIpUpdate(message.ip, message.provider, message.timestamp);
  } else if (message.type === "IP_CHECK_FAILED") {
    console.warn("All IP providers failed!");
    // Immediate Fail-Closed
    lastIpCheckTime = 0; // Invalidate lease
    if (currentIp !== "Unknown (Check Failed)") {
        currentIp = "Unknown (Check Failed)";
        chrome.storage.local.set({ currentIp: currentIp });
        updateDnrRules();
    }
  } else if (message.type === "CHECK_IP_NOW") {
    safeSendMessage({ type: "FORCE_CHECK" });
    sendResponse({ success: true });
  } else if (message.type === "DIAGNOSE_RULE") {
      diagnoseRule(message.domain).then(sendResponse);
      return true;
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
      // Lease renewal
      if (currentIp.includes("Unknown")) {
          // Recovery from expired state
          currentIp = newIp;
          await chrome.storage.local.set({ currentIp: currentIp });
          await updateDnrRules();
      }
  }
}

// --- Lease Monitor ---

async function checkLease() {
  const now = Date.now();
  const timeout = settings.leaseTimeout || DEFAULT_LEASE_TIMEOUT;
  const isExpired = (now - lastIpCheckTime) > timeout;

  // If expired, force update rules to remove Allows
  if (isExpired && !currentIp.includes("Unknown")) {
     console.warn("IP Lease Expired! Reverting to Block.");
     currentIp = "Unknown (Lease Expired)"; // Invalidate IP
     await chrome.storage.local.set({ currentIp: currentIp });
     await updateDnrRules();
  }
}

// --- DNR Rule Management ---

async function updateDnrRules() {
  // Sync Offscreen lifecycle based on rules count
  setupOffscreenDocument();

  const extensionId = chrome.runtime.id;
  const newRules = [];

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

    // IDs
    const baseId = (index * 10) + 1;
    const blockId = (index * 10) + 2;
    const allowId = (index * 10) + 3;

    // Regex for domain & subdomains (Hardened for websocket schemes too)
    const regex = `^(https?|wss?)://([a-z0-9-]+\\.)*${escapeRegex(domain)}(/.*)?$`;
    const redirectUrl = `chrome-extension://${extensionId}/${BLOCK_PAGE_PATH}?url=\\0`;

    // A. Base Redirect Rule (Priority 1) - Targets main/sub frames to show UI
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

    // B. Base Block Rule (Priority 1) - Targets ALL OTHER resources (Silent Fail)
    newRules.push({
      id: blockId,
      priority: 1,
      action: { type: "block" },
      condition: {
        regexFilter: regex,
        resourceTypes: ["stylesheet", "script", "image", "font", "object", "xmlhttprequest", "ping", "csp_report", "media", "websocket", "other"]
      }
    });

    // C. Allow Rule (Priority 2) - Only if IP matches AND lease is valid AND not panic
    if (!panicMode && isLeaseValid && currentIp && !currentIp.includes("Unknown") && rule.ips && rule.ips.length > 0) {
       // Check against list (including CIDR)
       const isAllowed = rule.ips.some(allowedIp => {
           const cleanAllowed = allowedIp.trim();
           if (cleanAllowed.includes("/")) {
               return ipInCidr(currentIp, cleanAllowed);
           }
           return cleanAllowed === currentIp;
       });

       if (isAllowed) {
          // Allow EVERYTHING for this domain
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

// --- Dynamic Icon ---
function setDynamicIcon() {
    try {
        const canvas = new OffscreenCanvas(48, 48);
        const ctx = canvas.getContext('2d');

        // Background
        ctx.fillStyle = '#1e1e1e';
        ctx.beginPath();
        ctx.roundRect(0, 0, 48, 48, 8);
        ctx.fill();

        // Text
        ctx.fillStyle = '#4caf50'; // Green
        ctx.font = 'bold 26px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('IP', 24, 26);

        const imageData = ctx.getImageData(0, 0, 48, 48);
        chrome.action.setIcon({ imageData: imageData }, () => {
            if (chrome.runtime.lastError) {
                // Ignore
            }
        });
    } catch(e) {
        // OffscreenCanvas not supported (older browsers)
    }
}

// --- CIDR Logic (Hardened) ---

function ipInCidr(ip, cidr) {
    if (!ip || !cidr) return false;
    const ipRegex = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/;
    if (!ipRegex.test(ip)) return false;

    try {
        const parts = cidr.split('/');
        if (parts.length !== 2) return false;

        const range = parts[0];
        const bits = parseInt(parts[1], 10);

        if (isNaN(bits) || bits < 0 || bits > 32) return false;
        if (!ipRegex.test(range)) return false;

        const mask = ~(2**(32 - bits) - 1);
        return (ipToLong(ip) & mask) === (ipToLong(range) & mask);
    } catch(e) {
        return false;
    }
}

function ipToLong(ip) {
    return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
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
        else {
             const isAllowed = rule.ips.some(allowedIp => {
                const cleanAllowed = allowedIp.trim();
                if (cleanAllowed.includes("/")) {
                    return ipInCidr(currentIp, cleanAllowed);
                }
                return cleanAllowed === currentIp;
            });

            if (isAllowed) status = "ALLOWED";
            else status = "BLOCKED (IP Mismatch)";
        }
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
      // Normalize
      rules = rules.map(r => ({ ...r, ips: Array.isArray(r.ips) ? r.ips : [] }));
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
