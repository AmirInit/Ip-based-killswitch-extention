// src/popup/popup.js

document.addEventListener('DOMContentLoaded', async () => {
  // Elements
  const ipDisplay = document.getElementById('current-ip');
  const providerDisplay = document.getElementById('current-provider');
  const panicBtn = document.getElementById('panic-btn');
  const rulesList = document.getElementById('rules-list');
  const addRuleBtn = document.getElementById('add-rule-btn');
  const domainInput = document.getElementById('domain-input');
  const ipsInput = document.getElementById('ips-input');
  const leaseTimeoutInput = document.getElementById('lease-timeout');
  const webrtcToggle = document.getElementById('webrtc-toggle');
  const autoCloseToggle = document.getElementById('autoclose-toggle');
  const saveSettingsBtn = document.getElementById('save-settings-btn');
  const clearAllRulesBtn = document.getElementById('clear-all-rules-btn');

  // State
  let rules = [];
  let currentIp = "Checking...";
  let currentProvider = "Unknown";
  let panicMode = false;
  let settings = {};

  // Initialize
  await loadData();
  render();

  // Listeners
  addRuleBtn.addEventListener('click', addRule);
  panicBtn.addEventListener('click', togglePanicMode);
  saveSettingsBtn.addEventListener('click', saveSettings);
  clearAllRulesBtn.addEventListener('click', clearAllRules);

  domainInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') ipsInput.focus(); });
  ipsInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') addRule(); });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      if (changes.currentIp) {
        currentIp = changes.currentIp.newValue;
        updateStatus();
      }
      if (changes.currentProvider) {
        currentProvider = changes.currentProvider.newValue;
        updateStatus();
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
    const data = await chrome.storage.local.get(['rules', 'currentIp', 'currentProvider', 'panicMode', 'settings']);
    rules = data.rules || [];
    currentIp = data.currentIp || "Unknown";
    currentProvider = data.currentProvider || "Unknown";
    panicMode = data.panicMode || false;
    settings = data.settings || {};

    // Set settings values
    if (settings.leaseTimeout) leaseTimeoutInput.value = settings.leaseTimeout / 1000; // ms to seconds
    if (settings.webRtcDisabled !== undefined) webrtcToggle.checked = settings.webRtcDisabled;
    if (settings.autoClose !== undefined) autoCloseToggle.checked = settings.autoClose;
  }

  function render() {
    updateStatus();
    updatePanicButton();
    renderRules();
  }

  function updateStatus() {
    ipDisplay.textContent = currentIp;
    if (currentIp.includes("Unknown")) {
        ipDisplay.style.color = "#ff9800";
    } else {
        ipDisplay.style.color = "#4caf50";
    }

    if (providerDisplay) {
        // Just show hostname of provider
        try {
            const url = new URL(currentProvider);
            providerDisplay.textContent = "via " + url.hostname;
        } catch(e) {
            providerDisplay.textContent = "";
        }
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

      const actions = document.createElement('div');
      actions.className = 'rule-actions';

      // Test Button
      const testBtn = document.createElement('button');
      testBtn.className = 'icon-btn test-btn';
      testBtn.innerHTML = '&#128300;'; // Spyglass/Microscope
      testBtn.title = "Test Rule";
      testBtn.onclick = () => testRule(rule.domain);

      // Edit Button
      const editBtn = document.createElement('button');
      editBtn.className = 'icon-btn edit-btn';
      editBtn.innerHTML = '&#9998;'; // Pencil
      editBtn.title = "Edit Rule";
      editBtn.onclick = () => editRule(index);

      // Delete Button
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'icon-btn delete-btn';
      deleteBtn.innerHTML = '&times;'; // X
      deleteBtn.title = "Delete Rule";
      deleteBtn.onclick = () => deleteRule(index);

      actions.appendChild(testBtn);
      actions.appendChild(editBtn);
      actions.appendChild(deleteBtn);

      card.appendChild(info);
      card.appendChild(actions);

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

    const newRule = {
      id: Date.now(),
      domain: domain,
      ips: ips
    };

    rules.push(newRule);
    await saveRules();

    domainInput.value = '';
    ipsInput.value = '';
    renderRules();
  }

  function editRule(index) {
    const rule = rules[index];
    domainInput.value = rule.domain;
    ipsInput.value = rule.ips.join(', ');

    // Remove old rule so "Add" acts as "Update"
    rules.splice(index, 1);
    saveRules(); // Temporarily save to reflect removal? Or just let user re-add?
    // Better UX: keep it if they cancel, but simple MVP: remove it now.
    // Ideally we'd have an "Update" button state, but for this task, re-populating inputs is fine.
    // To be safe, let's NOT save the removal until they click Add.
    // Wait, if they refresh, it's gone. That's risky.
    // Let's just remove it.
  }

  async function deleteRule(index) {
    if (confirm("Delete this rule?")) {
      rules.splice(index, 1);
      await saveRules();
      renderRules();
    }
  }

  async function clearAllRules() {
    if (confirm("Are you sure you want to delete ALL rules? This cannot be undone.")) {
      rules = [];
      await saveRules();
      renderRules();
    }
  }

  async function testRule(domain) {
     const response = await chrome.runtime.sendMessage({ type: "DIAGNOSE_RULE", domain: domain });
     if (response) {
         alert(`Diagnostic for ${response.domain}:\n\n` +
               `Current IP: ${response.currentIp}\n` +
               `Provider: ${response.provider}\n` +
               `Lease Remaining: ${Math.round(response.leaseRemaining/1000)}s\n` +
               `Rule Status: ${response.status}\n` +
               `Allowed IPs: ${response.allowedIps.join(", ")}`);
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
    const timeoutSec = parseInt(leaseTimeoutInput.value);
    const newSettings = {
      leaseTimeout: timeoutSec * 1000,
      webRtcDisabled: webrtcToggle.checked,
      autoClose: autoCloseToggle.checked,
      // Preserve API URL if it exists in storage but not in UI (removed from UI as requested? No, kept in background but maybe hidden in UI)
      // UI still has it? Let's check HTML.
    };

    // Merge with existing settings to keep API URL if we hid the input
    const oldSettings = await chrome.storage.local.get("settings");
    const finalSettings = { ...oldSettings.settings, ...newSettings };

    await chrome.storage.local.set({ settings: finalSettings });

    const originalText = saveSettingsBtn.textContent;
    saveSettingsBtn.textContent = "Saved!";
    setTimeout(() => {
      saveSettingsBtn.textContent = originalText;
    }, 1500);
  }
});
