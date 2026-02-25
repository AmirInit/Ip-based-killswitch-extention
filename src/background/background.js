// src/background/background.js

// Constants
const ALARM_NAME = "ip_check_alarm";
const DEFAULT_IP_API = "https://api.ipify.org?format=json";
const PANIC_MODE_RULE_ID = 999999;
const BLOCK_PAGE_PATH = "src/blocked/blocked.html";

// State
let currentIp = null;
let panicMode = false;
let rules = []; // { id: number (legacy), domain: string, ips: string[] }
let settings = {
  ipApiUrl: DEFAULT_IP_API,
  webRtcDisabled: true,
  autoClose: false
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
  loadSettings().then(() => {
    startAlarm();
    checkIp();
  });
}

// --- Alarms & Timers ---

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    checkIp();
  }
});

function startAlarm() {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
}

// --- Storage & Settings ---

async function loadSettings() {
  const data = await chrome.storage.local.get(["rules", "settings", "panicMode"]);
  rules = data.rules || [];
  settings = { ...settings, ...data.settings };
  panicMode = data.panicMode || false;

  applyWebRtcSetting();

  // Need to wait for IP check? No, default to block logic if IP is unknown.
  // But we try to load cached IP if available
  const cachedIpData = await chrome.storage.local.get("currentIp");
  if (cachedIpData.currentIp) {
      currentIp = cachedIpData.currentIp;
  }

  await updateDnrRules();
}

// Listen for storage changes
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local") {
    let needsRuleUpdate = false;

    if (changes.rules) {
      rules = changes.rules.newValue || [];
      needsRuleUpdate = true;
    }

    if (changes.settings) {
      const oldApi = settings.ipApiUrl;
      const oldWebRtc = settings.webRtcDisabled;

      settings = { ...settings, ...changes.settings.newValue };

      if (settings.ipApiUrl !== oldApi) {
        checkIp();
      }
      if (settings.webRtcDisabled !== oldWebRtc) {
        applyWebRtcSetting();
      }
    }

    if (changes.panicMode) {
      panicMode = changes.panicMode.newValue;
      needsRuleUpdate = true;
    }

    if (needsRuleUpdate) {
      updateDnrRules();
    }
  }
});

// --- IP Detection ---

async function checkIp() {
  try {
    const apiUrl = settings.ipApiUrl || DEFAULT_IP_API;
    const response = await fetch(apiUrl);
    let ip = "";
    const contentType = response.headers.get("content-type");

    if (contentType && contentType.includes("application/json")) {
      const json = await response.json();
      ip = json.ip; // Assumes standard JSON response with 'ip' field
      if (!ip) {
          // Fallback for some APIs that might return slightly different JSON
          ip = json.query || json.origin || "";
      }
    } else {
      const text = await response.text();
      ip = text.trim();
    }

    // Basic cleaning (remove newlines etc)
    ip = ip.replace(/[\r\n]/g, '');

    if (isValidIp(ip)) {
      if (currentIp !== ip) {
        console.log(`IP Changed: ${currentIp} -> ${ip}`);
        currentIp = ip;
        await chrome.storage.local.set({ currentIp: ip });
        await updateDnrRules();
      }
    } else {
      console.warn("Invalid IP fetched:", ip);
    }
  } catch (err) {
    console.error("IP Fetch Error:", err);
  }
}

function isValidIp(ip) {
  return /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(ip) || /^[a-fA-F0-9:]+$/.test(ip);
}

// --- WebRTC Handling ---

function applyWebRtcSetting() {
  if (!chrome.privacy || !chrome.privacy.network) return;

  // 'disable_non_proxied_udp' is the standard way to prevent leaks
  const value = settings.webRtcDisabled ?
    'disable_non_proxied_udp' :
    'default';

  chrome.privacy.network.webRTCIPHandlingPolicy.set({ value: value }, () => {
     if (chrome.runtime.lastError) console.error("WebRTC Error:", chrome.runtime.lastError);
  });
}

// --- DNR Rule Management ---

async function updateDnrRules() {
  const extensionId = chrome.runtime.id;
  const newRules = [];

  // Panic Mode Rule
  if (panicMode) {
    newRules.push({
      id: PANIC_MODE_RULE_ID,
      priority: 3,
      action: { type: "block" },
      // Empty resourceTypes means ALL types (including WebSocket, media, etc.)
      condition: { urlFilter: "*" }
    });
  }

  // Domain Rules
  // We use index-based IDs to ensure they fit in integer range
  rules.forEach((rule, index) => {
    if (!rule.domain) return;

    let domain = rule.domain.trim();
    // Strip protocol and path if user entered them
    domain = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!domain) return;

    const baseId = index + 1; // 1, 2, 3...
    const allowId = index + 10001; // 10001, 10002...

    // 1. Base Redirect Rule (Priority 1)
    // Matches http/https, domain and subdomains
    // Regex: ^https?://([a-z0-9-]+\.)*example\.com/.*
    // We add /.* to match path
    const regex = `^https?://([a-z0-9-]+\\.)*${escapeRegex(domain)}(/.*)?$`;

    // Redirect URL: blocked.html?url=...
    const redirectUrl = `chrome-extension://${extensionId}/${BLOCK_PAGE_PATH}?url=\\0`;

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

    // 2. Allow Rule (Priority 2)
    const allowedIps = rule.ips || [];
    const isIpAllowed = currentIp && allowedIps.includes(currentIp);

    if (isIpAllowed && !panicMode) {
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
  });

  // Remove all existing dynamic rules first
  const currentRules = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = currentRules.map(r => r.id);

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: removeRuleIds,
    addRules: newRules
  });

  // console.log("Updated DNR Rules. Active rules:", newRules.length);
}

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// --- Message Handling ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "CHECK_IP_NOW") {
    checkIp().then(() => sendResponse({ success: true }));
    return true;
  }
});
