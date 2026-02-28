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
    // Only redirect if valid HTTP/HTTPS URL
    if (targetUrl.startsWith('http')) {
        window.location.href = targetUrl;
    }
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
    // Open Popup in a new tab
    chrome.tabs.create({ url: chrome.runtime.getURL('popup/popup.html') });
  });

  // --- Auto-Reload Logic ---
  chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local") {
          // Check if auto-reload is enabled
          chrome.storage.local.get("settings").then(data => {
             const autoReload = data.settings && data.settings.autoReload;
             if (autoReload) {
                 // Check if we are now allowed
                 checkStatus().then(allowed => {
                     if (allowed && targetUrl && targetUrl.startsWith('http')) {
                         console.log("Auto-Reloading...");
                         window.location.href = targetUrl;
                     }
                 });
             }
          });
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
    if (currentIp.includes("Unknown")) {
      currentIpEl.style.color = "#ff9800";
    } else {
      currentIpEl.style.color = "#f44336"; // Blocked usually implies mismatch, so red
    }

    // Find applicable rule
    // We match against hostname.
    const applicableRule = rules.find(r => {
      if (!r.domain) return false;
      const domain = r.domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
      return targetHostname === domain || targetHostname.endsWith("." + domain);
    });

    if (applicableRule) {
      const allowedIps = Array.isArray(applicableRule.ips) ? applicableRule.ips : [];
      allowedIpsEl.textContent = allowedIps.join(", ");

      // Check if NOW allowed
      const isAllowed = allowedIps.some(allowedIp => {
           const cleanAllowed = allowedIp.trim();
           if (cleanAllowed.includes("/")) {
               return ipInCidr(currentIp, cleanAllowed);
           }
           return cleanAllowed === currentIp;
       });

      if (isAllowed && !panicMode && !currentIp.includes("Unknown")) {
        currentIpEl.style.color = "#4caf50";
        return true;
      }
    } else {
      allowedIpsEl.textContent = "No specific rule found (Panic Mode?)";
    }

    return false;
  }

  // Duplicated CIDR Logic (should be shared but importing modules in vanilla JS extension is tricky without build step)
  // Simple enough to copy for now.
  function ipInCidr(ip, cidr) {
    try {
        const [range, bitsStr] = cidr.split('/');
        const bits = parseInt(bitsStr, 10);
        // Strict validation: Must be IPv4, bits between 0 and 32
        if (isNaN(bits) || bits < 0 || bits > 32) return false;

        // Basic IPv4 regex for range and ip
        const ipv4Regex = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/;
        if (!ipv4Regex.test(range) || !ipv4Regex.test(ip)) return false;

        const mask = ~(2**(32 - bits) - 1);
        return (ipToLong(ip) & mask) === (ipToLong(range) & mask);
    } catch(e) {
        return false;
    }
  }

  function ipToLong(ip) {
    return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
  }
});
