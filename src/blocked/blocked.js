// src/blocked/blocked.js

document.addEventListener('DOMContentLoaded', async () => {
  const targetDomainEl = document.getElementById('target-domain');
  const currentIpEl = document.getElementById('current-ip');
  const allowedIpsEl = document.getElementById('allowed-ips');
  const retryBtn = document.getElementById('retry-btn');
  const settingsBtn = document.getElementById('settings-btn');

  // Parse Query Param
  const params = new URLSearchParams(window.location.search);
  const targetUrl = params.get('url');

  if (!targetUrl) {
    targetDomainEl.textContent = "Unknown URL";
    return;
  }

  let targetHostname;
  try {
    targetHostname = new URL(targetUrl).hostname;
    targetDomainEl.textContent = targetHostname;
  } catch (e) {
    targetDomainEl.textContent = targetUrl;
  }

  // Load initial data
  const isAllowedInitially = await checkStatus();
  if (isAllowedInitially && targetUrl) {
    window.location.href = targetUrl;
    return;
  }

  // Listeners
  retryBtn.addEventListener('click', async () => {
    retryBtn.textContent = "Checking...";
    retryBtn.disabled = true;

    // Ask background to check IP immediately
    chrome.runtime.sendMessage({ type: "CHECK_IP_NOW" }, async () => {
      // Wait a bit for storage to update
      setTimeout(async () => {
        const allowed = await checkStatus();
        if (allowed) {
          window.location.href = targetUrl;
        } else {
          retryBtn.textContent = "Still Blocked - Retry";
          retryBtn.disabled = false;
        }
      }, 1000);
    });
  });

  settingsBtn.addEventListener('click', () => {
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open(chrome.runtime.getURL('src/popup/popup.html'));
    }
  });

  // --- Functions ---

  async function checkStatus() {
    const data = await chrome.storage.local.get(['rules', 'currentIp', 'settings', 'panicMode']);
    const rules = data.rules || [];
    const currentIp = data.currentIp || "Unknown";
    const settings = data.settings || {};
    const panicMode = data.panicMode || false;

    // Auto-Close Logic
    if (settings.autoClose) {
      chrome.tabs.getCurrent((tab) => {
        if (tab) chrome.tabs.remove(tab.id);
      });
      return false;
    }

    // Display IP
    currentIpEl.textContent = currentIp;
    if (currentIp === "Unknown") {
      currentIpEl.style.color = "#ff9800";
    } else {
      currentIpEl.style.color = "#f44336"; // Blocked usually implies mismatch, so red
    }

    // Find applicable rule
    // We match against hostname.
    // Logic: find rule where hostname ends with rule.domain (or is exactly rule.domain)
    const applicableRule = rules.find(r => {
      // Simple match: does hostname end with domain?
      // e.g. target: sub.example.com, rule: example.com -> Yes
      if (!r.domain) return false;
      const domain = r.domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
      return targetHostname === domain || targetHostname.endsWith("." + domain);
    });

    if (applicableRule) {
      allowedIpsEl.textContent = applicableRule.ips.join(", ");

      // Check if NOW allowed
      if (applicableRule.ips.includes(currentIp) && !panicMode) {
        currentIpEl.style.color = "#4caf50";
        return true;
      }
    } else {
      allowedIpsEl.textContent = "No specific rule found (Panic Mode?)";
    }

    return false;
  }
});
