// src/popup/popup.js

document.addEventListener('DOMContentLoaded', async () => {
  // Elements
  const ipDisplay = document.getElementById('current-ip');
  const panicBtn = document.getElementById('panic-btn');
  const rulesList = document.getElementById('rules-list');
  const addRuleBtn = document.getElementById('add-rule-btn');
  const domainInput = document.getElementById('domain-input');
  const ipsInput = document.getElementById('ips-input');
  const apiUrlInput = document.getElementById('api-url');
  const webrtcToggle = document.getElementById('webrtc-toggle');
  const autoCloseToggle = document.getElementById('autoclose-toggle');
  const saveSettingsBtn = document.getElementById('save-settings-btn');

  // State
  let rules = [];
  let currentIp = "Checking...";
  let panicMode = false;
  let settings = {};

  // Initialize
  await loadData();
  render();

  // Listeners
  addRuleBtn.addEventListener('click', addRule);
  panicBtn.addEventListener('click', togglePanicMode);
  saveSettingsBtn.addEventListener('click', saveSettings);

  // Allow Enter key to add rule
  domainInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') ipsInput.focus(); });
  ipsInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') addRule(); });

  // Storage listener for background updates (IP change, etc.)
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      if (changes.currentIp) {
        currentIp = changes.currentIp.newValue;
        updateIpDisplay();
      }
      if (changes.panicMode) {
        panicMode = changes.panicMode.newValue;
        updatePanicButton();
      }
      if (changes.rules) {
        rules = changes.rules.newValue;
        renderRules();
      }
    }
  });

  // --- Functions ---

  async function loadData() {
    const data = await chrome.storage.local.get(['rules', 'currentIp', 'panicMode', 'settings']);
    rules = data.rules || [];
    currentIp = data.currentIp || "Unknown";
    panicMode = data.panicMode || false;
    settings = data.settings || {};

    // Set settings values
    if (settings.ipApiUrl) apiUrlInput.value = settings.ipApiUrl;
    if (settings.webRtcDisabled !== undefined) webrtcToggle.checked = settings.webRtcDisabled;
    if (settings.autoClose !== undefined) autoCloseToggle.checked = settings.autoClose;
  }

  function render() {
    updateIpDisplay();
    updatePanicButton();
    renderRules();
  }

  function updateIpDisplay() {
    ipDisplay.textContent = currentIp;
    if (currentIp === "Unknown" || currentIp === "Checking...") {
        ipDisplay.style.color = "#ff9800";
    } else {
        ipDisplay.style.color = "#4caf50";
    }
  }

  function updatePanicButton() {
    if (panicMode) {
      panicBtn.textContent = "PANIC MODE: ACTIVE";
      panicBtn.classList.add('active');
      panicBtn.style.backgroundColor = "#f44336";
    } else {
      panicBtn.textContent = "PANIC MODE: OFF";
      panicBtn.classList.remove('active');
      panicBtn.style.backgroundColor = "#333";
    }
  }

  function renderRules() {
    rulesList.innerHTML = '';

    if (rules.length === 0) {
      rulesList.innerHTML = '<div class="empty-state">No rules added.</div>';
      return;
    }

    rules.forEach((rule, index) => {
      const card = document.createElement('div');
      card.className = 'rule-card';

      const info = document.createElement('div');
      info.className = 'rule-info';

      const domain = document.createElement('div');
      domain.className = 'rule-domain';
      domain.textContent = rule.domain;

      const ips = document.createElement('div');
      ips.className = 'rule-ips';
      ips.textContent = rule.ips.join(', ');

      info.appendChild(domain);
      info.appendChild(ips);

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'delete-btn';
      deleteBtn.innerHTML = '&times;'; // X icon
      deleteBtn.title = "Delete Rule";
      deleteBtn.onclick = () => deleteRule(index);

      card.appendChild(info);
      card.appendChild(deleteBtn);

      rulesList.appendChild(card);
    });
  }

  async function addRule() {
    const domain = domainInput.value.trim();
    const ipsText = ipsInput.value.trim();

    if (!domain) {
      alert("Please enter a domain.");
      return;
    }

    if (!ipsText) {
      alert("Please enter at least one IP.");
      return;
    }

    const ips = ipsText.split(',').map(ip => ip.trim()).filter(ip => ip);

    // Basic validation
    // Could check regex for IP but simple is fine for now

    const newRule = {
      id: Date.now(), // Just for unique key if needed, background uses index
      domain: domain,
      ips: ips
    };

    rules.push(newRule);
    await saveRules();

    domainInput.value = '';
    ipsInput.value = '';
    renderRules();
  }

  async function deleteRule(index) {
    if (confirm("Delete this rule?")) {
      rules.splice(index, 1);
      await saveRules();
      renderRules();
    }
  }

  async function saveRules() {
    await chrome.storage.local.set({ rules: rules });
  }

  async function togglePanicMode() {
    panicMode = !panicMode;
    await chrome.storage.local.set({ panicMode: panicMode });
    updatePanicButton();
  }

  async function saveSettings() {
    const newSettings = {
      ipApiUrl: apiUrlInput.value.trim(),
      webRtcDisabled: webrtcToggle.checked,
      autoClose: autoCloseToggle.checked
    };

    await chrome.storage.local.set({ settings: newSettings });

    // Visual feedback
    const originalText = saveSettingsBtn.textContent;
    saveSettingsBtn.textContent = "Saved!";
    setTimeout(() => {
      saveSettingsBtn.textContent = originalText;
    }, 1500);

    // Trigger IP check manually if URL changed
    if (newSettings.ipApiUrl !== settings.ipApiUrl) {
      chrome.runtime.sendMessage({ type: "CHECK_IP_NOW" });
    }
    settings = newSettings;
  }
});
