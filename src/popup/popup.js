// src/popup/popup.js

document.addEventListener('DOMContentLoaded', async () => {
  // Elements
  const ipDisplay = document.getElementById('current-ip');
  const providerDisplay = document.getElementById('current-provider');
  const panicBtn = document.getElementById('panic-btn');
  const rulesList = document.getElementById('rules-list');

  const formTitle = document.getElementById('form-title');
  const addRuleBtn = document.getElementById('add-rule-btn');
  const cancelEditBtn = document.getElementById('cancel-edit-btn');
  const domainInput = document.getElementById('domain-input');
  const ipsInput = document.getElementById('ips-input');

  const leaseTimeoutInput = document.getElementById('lease-timeout');
  const webrtcToggle = document.getElementById('webrtc-toggle');
  const autoCloseToggle = document.getElementById('autoclose-toggle');
  const autoReloadToggle = document.getElementById('autoreload-toggle');
  const saveSettingsBtn = document.getElementById('save-settings-btn');
  const clearAllRulesBtn = document.getElementById('clear-all-rules-btn');

  const exportBtn = document.getElementById('export-btn');
  const importBtn = document.getElementById('import-btn');
  const importFile = document.getElementById('import-file');

  // State
  let rules = [];
  let currentIp = "Checking...";
  let currentProvider = "Unknown";
  let panicMode = false;
  let settings = {};

  // Edit Mode State
  let isEditing = false;
  let editIndex = -1;

  // Initialize
  await loadData();
  render();

  // Listeners
  addRuleBtn.addEventListener('click', handleAddOrUpdateRule);
  cancelEditBtn.addEventListener('click', cancelEdit);

  panicBtn.addEventListener('click', togglePanicMode);
  saveSettingsBtn.addEventListener('click', saveSettings);
  clearAllRulesBtn.addEventListener('click', clearAllRules);

  exportBtn.addEventListener('click', exportRules);
  importBtn.addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', importRules);

  domainInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') ipsInput.focus(); });
  ipsInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') handleAddOrUpdateRule(); });

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
    // Migration: Fix malformed rules
    rules = rules.map(r => ({
        id: r.id || Date.now() + Math.random(),
        domain: r.domain || "unknown",
        ips: Array.isArray(r.ips) ? r.ips : []
    }));

    currentIp = data.currentIp || "Unknown";
    currentProvider = data.currentProvider || "Unknown";
    panicMode = data.panicMode || false;
    settings = data.settings || {};

    // Set settings values
    if (settings.leaseTimeout) leaseTimeoutInput.value = settings.leaseTimeout / 1000;
    if (settings.webRtcDisabled !== undefined) webrtcToggle.checked = settings.webRtcDisabled;
    if (settings.autoClose !== undefined) autoCloseToggle.checked = settings.autoClose;
    if (settings.autoReload !== undefined) {
        autoReloadToggle.checked = settings.autoReload;
        autoReloadToggle.disabled = false; // Enable if saved
    } else {
        autoReloadToggle.checked = false;
        autoReloadToggle.disabled = false; // Enable default
    }
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

    if (!rules || rules.length === 0) {
      rulesList.innerHTML = '<div class="empty-state">No rules added.</div>';
      return;
    }

    rules.forEach((rule, index) => {
      // Defensive check
      if (!rule || !rule.domain) return;

      const card = document.createElement('div');
      card.className = 'rule-card';
      if (isEditing && editIndex === index) {
          card.style.opacity = "0.5";
          card.style.border = "1px dashed #2196f3";
      }

      const info = document.createElement('div');
      info.className = 'rule-info';

      const domain = document.createElement('div');
      domain.className = 'rule-domain';
      domain.textContent = rule.domain;

      const ips = document.createElement('div');
      ips.className = 'rule-ips';
      // Ensure ips is array
      const ipsList = Array.isArray(rule.ips) ? rule.ips : [];
      ips.textContent = ipsList.join(', ');

      info.appendChild(domain);
      info.appendChild(ips);

      const actions = document.createElement('div');
      actions.className = 'rule-actions';

      // Test Button
      const testBtn = document.createElement('button');
      testBtn.className = 'icon-btn test-btn';
      testBtn.innerHTML = '&#128300;'; // Spyglass
      testBtn.title = "Test Rule";
      testBtn.onclick = () => testRule(rule.domain);

      // Edit Button
      const editBtn = document.createElement('button');
      editBtn.className = 'icon-btn edit-btn';
      editBtn.innerHTML = '&#9998;'; // Pencil
      editBtn.title = "Edit Rule";
      editBtn.onclick = () => startEditRule(index);

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

  // --- Actions ---

  async function handleAddOrUpdateRule() {
    const domainText = domainInput.value.trim();
    const ipsText = ipsInput.value.trim();

    if (!domainText) {
      alert("Please enter a domain.");
      return;
    }

    if (!ipsText) {
      alert("Please enter at least one IP.");
      return;
    }

    const ips = ipsText.split(',').map(ip => ip.trim()).filter(ip => ip);

    if (isEditing && editIndex >= 0) {
        // Update Single Rule (Single Domain Edit)
        rules[editIndex] = {
            ...rules[editIndex],
            domain: domainText, // Assuming user edited specific domain
            ips: ips
        };
        cancelEdit();
    } else {
        // Add (Support Multi-Domain)
        const domains = domainText.split(',').map(d => d.trim()).filter(d => d);

        domains.forEach(domain => {
            // Deduplicate? Check if domain exists?
            // Simple: Just push. Background handles duplication if keyed by domain,
            // but here we rely on list. UI shows duplicates.
            // Better: Check if exists.
            const existing = rules.findIndex(r => r.domain === domain);
            if (existing >= 0) {
                // Update existing
                rules[existing].ips = ips;
            } else {
                rules.push({
                  id: Date.now() + Math.random(),
                  domain: domain,
                  ips: ips
                });
            }
        });
    }

    await saveRules();

    domainInput.value = '';
    ipsInput.value = '';
    renderRules();
  }

  function startEditRule(index) {
      isEditing = true;
      editIndex = index;

      const rule = rules[index];
      domainInput.value = rule.domain;
      ipsInput.value = (rule.ips || []).join(', ');

      formTitle.textContent = "Edit Rule";
      addRuleBtn.textContent = "Update Rule";
      cancelEditBtn.style.display = "inline-block";

      renderRules();
  }

  function cancelEdit() {
      isEditing = false;
      editIndex = -1;

      domainInput.value = '';
      ipsInput.value = '';

      formTitle.textContent = "Add New Rule";
      addRuleBtn.textContent = "Add Rule";
      cancelEditBtn.style.display = "none";

      renderRules();
  }

  async function deleteRule(index) {
    if (confirm("Delete this rule?")) {
      rules.splice(index, 1);
      if (isEditing && editIndex === index) cancelEdit();
      else if (isEditing && editIndex > index) editIndex--;

      await saveRules();
      renderRules();
    }
  }

  async function clearAllRules() {
    if (confirm("Are you sure you want to delete ALL rules?")) {
      rules = [];
      cancelEdit();
      await saveRules();
      renderRules();
    }
  }

  async function testRule(domain) {
     const response = await chrome.runtime.sendMessage({ type: "DIAGNOSE_RULE", domain: domain });
     if (response) {
         const ips = response.allowedIps ? response.allowedIps.join(", ") : "None";
         alert(`Diagnostic for ${response.domain}:\n\n` +
               `Current IP: ${response.currentIp}\n` +
               `Provider: ${response.provider}\n` +
               `Lease Remaining: ${Math.round(response.leaseRemaining/1000)}s\n` +
               `Rule Status: ${response.status}\n` +
               `Allowed IPs: ${ips}`);
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
      autoReload: autoReloadToggle.checked
    };

    const oldSettings = await chrome.storage.local.get("settings");
    const finalSettings = { ...oldSettings.settings, ...newSettings };

    await chrome.storage.local.set({ settings: finalSettings });

    const originalText = saveSettingsBtn.textContent;
    saveSettingsBtn.textContent = "Saved!";
    setTimeout(() => {
      saveSettingsBtn.textContent = originalText;
    }, 1500);
  }

  // --- Import / Export ---

  function exportRules() {
      const data = {
          rules: rules,
          settings: settings,
          exportedAt: new Date().toISOString()
      };

      const blob = new Blob([JSON.stringify(data, null, 2)], {type: "application/json"});
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = 'ip-kill-switch-rules.json';
      a.click();
  }

  function importRules(e) {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (event) => {
          try {
              const data = JSON.parse(event.target.result);
              if (data.rules && Array.isArray(data.rules)) {
                  if (confirm(`Import ${data.rules.length} rules? This will MERGE with existing rules.`)) {
                      // Normalize
                      const newRules = data.rules.map(r => ({
                          id: r.id || Date.now() + Math.random(),
                          domain: r.domain || "unknown",
                          ips: Array.isArray(r.ips) ? r.ips : []
                      }));

                      const existingDomains = new Set(rules.map(r => r.domain));
                      let added = 0;

                      newRules.forEach(r => {
                          if (!existingDomains.has(r.domain)) {
                              rules.push(r);
                              added++;
                          } else {
                              // Optional: Overwrite IPs? Or skip?
                              // For safety, let's update existing to match import
                              const existingIdx = rules.findIndex(ex => ex.domain === r.domain);
                              if (existingIdx >= 0) {
                                  rules[existingIdx].ips = r.ips;
                                  added++; // Count as updated
                              }
                          }
                      });

                      await saveRules();
                      renderRules();
                      alert(`Imported/Updated ${added} rules.`);
                  }
              } else {
                  alert("Invalid format: 'rules' array missing.");
              }
          } catch(err) {
              alert("Error parsing JSON: " + err.message);
          }
      };
      reader.readAsText(file);
      importFile.value = '';
  }
});
