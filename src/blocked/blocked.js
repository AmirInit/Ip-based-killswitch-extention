// src/blocked/blocked.js

document.addEventListener('DOMContentLoaded', async () => {
  const targetDomainEl = document.getElementById('target-domain');
  const currentIpEl = document.getElementById('current-ip');
  const allowedIpsEl = document.getElementById('allowed-ips');
  const retryBtn = document.getElementById('retry-btn');
  const settingsBtn = document.getElementById('settings-btn');

  const params = new URLSearchParams(window.location.search);
  const targetUrl = params.get('url');

  if (!targetUrl) {
    targetDomainEl.textContent = 'Unknown URL';
    return;
  }

  let targetHostname;
  try {
    targetHostname = new URL(targetUrl).hostname;
    targetDomainEl.textContent = targetHostname;
  } catch (e) {
    targetDomainEl.textContent = targetUrl;
  }

  const isAllowedInitially = await checkStatus();
  if (isAllowedInitially && targetUrl && targetUrl.startsWith('http')) {
    window.location.href = targetUrl;
    return;
  }

  retryBtn.addEventListener('click', async () => {
    retryBtn.textContent = 'Checking...';
    retryBtn.disabled = true;

    chrome.runtime.sendMessage({ type: 'CHECK_IP_NOW' }, async () => {
      setTimeout(async () => {
        const allowed = await checkStatus();
        if (allowed) {
          window.location.href = targetUrl;
        } else {
          retryBtn.textContent = 'Still Blocked - Retry';
          retryBtn.disabled = false;
        }
      }, 1000);
    });
  });

  settingsBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('popup/popup.html') });
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      chrome.storage.local.get('settings').then(data => {
        const autoReload = data.settings && data.settings.autoReload;
        if (autoReload) {
          checkStatus().then(allowed => {
            if (allowed && targetUrl && targetUrl.startsWith('http')) {
              window.location.href = targetUrl;
            }
          });
        }
      });
    }
  });

  function normalizeDomain(domain) {
    if (typeof domain !== 'string') return '';
    return domain.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
  }

  function normalizeRulesArray(input) {
    if (!Array.isArray(input)) return [];
    return input
      .map((rule, index) => ({
        id: Number.isInteger(rule?.id) ? rule.id : Date.now() + index,
        domain: normalizeDomain(rule?.domain || ''),
        ips: Array.isArray(rule?.ips) ? rule.ips.map(ip => (typeof ip === 'string' ? ip.trim() : '')).filter(Boolean) : []
      }))
      .filter(rule => rule.domain);
  }

  async function checkStatus() {
    const data = await chrome.storage.local.get(['rules', 'currentIp', 'settings', 'panicMode']);
    const rules = normalizeRulesArray(data.rules || []);
    const currentIp = data.currentIp || 'Unknown';
    const settings = data.settings || {};
    const panicMode = data.panicMode || false;

    if (settings.autoClose) {
      chrome.tabs.getCurrent((tab) => {
        if (tab) chrome.tabs.remove(tab.id);
      });
      return false;
    }

    currentIpEl.textContent = currentIp;
    currentIpEl.style.color = currentIp.includes('Unknown') ? '#ff9800' : '#f44336';

    const applicableRule = rules.find(r => {
      const domain = normalizeDomain(r.domain);
      return targetHostname === domain || targetHostname.endsWith('.' + domain);
    });

    if (applicableRule) {
      const allowedList = Array.isArray(applicableRule.ips) ? applicableRule.ips : [];
      allowedIpsEl.textContent = allowedList.join(', ');

      const isAllowed = allowedList.some(allowedIp => {
        const cleanAllowed = allowedIp.trim();
        if (cleanAllowed.includes('/')) return ipInCidr(currentIp, cleanAllowed);
        return cleanAllowed === currentIp;
      });

      if (isAllowed && !panicMode && !currentIp.includes('Unknown')) {
        currentIpEl.style.color = '#4caf50';
        return true;
      }
    } else {
      allowedIpsEl.textContent = 'No specific rule found (Panic Mode?)';
    }

    return false;
  }

  function ipInCidr(ip, cidr) {
    if (!isValidIpv4(ip) || typeof cidr !== 'string') return false;
    const [range, bitsRaw] = cidr.split('/');
    if (!isValidIpv4(range) || bitsRaw === undefined || !/^\d+$/.test(bitsRaw)) return false;
    const bits = Number(bitsRaw);
    if (bits < 0 || bits > 32) return false;
    const mask = bits === 0 ? 0 : ((0xFFFFFFFF << (32 - bits)) >>> 0);
    return (ipToLong(ip) & mask) === (ipToLong(range) & mask);
  }

  function ipToLong(ip) {
    return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
  }

  function isValidIpv4(ip) {
    return /^(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(ip || '');
  }
});
