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
  let currentIp = 'Checking...';
  let currentProvider = 'Unknown';
  let panicMode = false;
  let settings = {};

  // Edit Mode State
  let isEditing = false;
  let editIndex = -1;

  await loadData();
  render();

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
        rules = normalizeRulesArray(changes.rules.newValue || []);
        renderRules();
      }
    }
  });

  function normalizeDomain(domain) {
    if (typeof domain !== 'string') return '';
    return domain.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
  }

  function normalizeRule(rawRule, index = 0) {
    const domain = normalizeDomain(rawRule?.domain || '');
    const ips = Array.isArray(rawRule?.ips)
      ? rawRule.ips.map(ip => (typeof ip === 'string' ? ip.trim() : '')).filter(Boolean)
      : [];
    const id = Number.isInteger(rawRule?.id) ? rawRule.id : (Date.now() + index);
    return { id, domain, ips };
  }

  function normalizeRulesArray(input) {
    if (!Array.isArray(input)) return [];
    const seen = new Set();
    const out = [];
    input.forEach((rule, index) => {
      const normalized = normalizeRule(rule, index);
      if (!normalized.domain || seen.has(normalized.domain)) return;
      seen.add(normalized.domain);
      out.push(normalized);
    });
    return out;
  }

  function parseDomainList(value) {
    const seen = new Set();
    return value
      .split(',')
      .map(part => normalizeDomain(part))
      .filter(domain => domain && !seen.has(domain) && seen.add(domain));
  }

  async function loadData() {
    const data = await chrome.storage.local.get(['rules', 'currentIp', 'currentProvider', 'panicMode', 'settings']);
    rules = normalizeRulesArray(data.rules || []);
    currentIp = data.currentIp || 'Unknown';
    currentProvider = data.currentProvider || 'Unknown';
    panicMode = data.panicMode || false;
    settings = data.settings || {};

    if (JSON.stringify(rules) !== JSON.stringify(data.rules || [])) {
      await chrome.storage.local.set({ rules });
    }

    if (settings.leaseTimeout) leaseTimeoutInput.value = settings.leaseTimeout / 1000;
    if (settings.webRtcDisabled !== undefined) webrtcToggle.checked = settings.webRtcDisabled;
    if (settings.autoClose !== undefined) autoCloseToggle.checked = settings.autoClose;
    if (settings.autoReload !== undefined) autoReloadToggle.checked = settings.autoReload;
  }

  function render() {
    updateStatus();
    updatePanicButton();
    renderRules();
  }

  function updateStatus() {
    ipDisplay.textContent = currentIp;
    ipDisplay.style.color = currentIp.includes('Unknown') ? '#ff9800' : '#4caf50';

    if (providerDisplay) {
      try {
        const url = new URL(currentProvider);
        providerDisplay.textContent = 'via ' + url.hostname;
      } catch {
        providerDisplay.textContent = '';
      }
    }
  }

  function updatePanicButton() {
    if (panicMode) {
      panicBtn.textContent = 'PANIC MODE: ACTIVE';
      panicBtn.classList.add('active');
      panicBtn.style.backgroundColor = '#f44336';
    } else {
      panicBtn.textContent = 'PANIC MODE: OFF';
      panicBtn.classList.remove('active');
      panicBtn.style.backgroundColor = '#333';
    }
  }

  function renderRules() {
    rulesList.innerHTML = '';

    if (!Array.isArray(rules) || rules.length === 0) {
      rulesList.innerHTML = '<div class="empty-state">No rules added.</div>';
      return;
    }

    rules.forEach((rule, index) => {
      const safeRule = normalizeRule(rule, index);
      const card = document.createElement('div');
      card.className = 'rule-card';
      if (isEditing && editIndex === index) {
        card.style.opacity = '0.5';
        card.style.border = '1px dashed #2196f3';
      }

      const info = document.createElement('div');
      info.className = 'rule-info';

      const domain = document.createElement('div');
      domain.className = 'rule-domain';
      domain.textContent = safeRule.domain || '(invalid rule)';

      const ips = document.createElement('div');
      ips.className = 'rule-ips';
      ips.textContent = (safeRule.ips || []).join(', ');

      info.appendChild(domain);
      info.appendChild(ips);

      const actions = document.createElement('div');
      actions.className = 'rule-actions';

      const testBtn = document.createElement('button');
      testBtn.className = 'icon-btn test-btn';
      testBtn.innerHTML = '&#128300;';
      testBtn.title = 'Test Rule';
      testBtn.onclick = () => testRule(safeRule.domain);

      const editBtn = document.createElement('button');
      editBtn.className = 'icon-btn edit-btn';
      editBtn.innerHTML = '&#9998;';
      editBtn.title = 'Edit Rule';
      editBtn.onclick = () => startEditRule(index);

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'icon-btn delete-btn';
      deleteBtn.innerHTML = '&times;';
      deleteBtn.title = 'Delete Rule';
      deleteBtn.onclick = () => deleteRule(index);

      actions.appendChild(testBtn);
      actions.appendChild(editBtn);
      actions.appendChild(deleteBtn);

      card.appendChild(info);
      card.appendChild(actions);

      rulesList.appendChild(card);
    });
  }

  async function handleAddOrUpdateRule() {
    const domains = parseDomainList(domainInput.value.trim());
    const ipsText = ipsInput.value.trim();

    if (domains.length === 0) {
      alert('Please enter at least one valid domain.');
      return;
    }

    if (!ipsText) {
      alert('Please enter at least one IP.');
      return;
    }

    const ips = ipsText.split(',').map(ip => ip.trim()).filter(Boolean);

    if (isEditing && editIndex >= 0) {
      if (domains.length !== 1) {
        alert('Editing supports a single domain. Use Add Rule for multi-domain input.');
        return;
      }
      rules[editIndex] = {
        ...normalizeRule(rules[editIndex], editIndex),
        domain: domains[0],
        ips
      };
      cancelEdit();
    } else {
      const byDomain = new Map(normalizeRulesArray(rules).map(rule => [rule.domain, rule]));
      domains.forEach(domain => {
        if (byDomain.has(domain)) {
          byDomain.set(domain, { ...byDomain.get(domain), ips });
        } else {
          byDomain.set(domain, { id: Date.now() + Math.floor(Math.random() * 1000), domain, ips });
        }
      });
      rules = [...byDomain.values()];
    }

    await saveRules();
    domainInput.value = '';
    ipsInput.value = '';
    renderRules();
  }

  function startEditRule(index) {
    isEditing = true;
    editIndex = index;

    const rule = normalizeRule(rules[index], index);
    domainInput.value = rule.domain;
    ipsInput.value = (rule.ips || []).join(', ');

    formTitle.textContent = 'Edit Rule';
    addRuleBtn.textContent = 'Update Rule';
    cancelEditBtn.style.display = 'inline-block';

    renderRules();
  }

  function cancelEdit() {
    isEditing = false;
    editIndex = -1;

    domainInput.value = '';
    ipsInput.value = '';

    formTitle.textContent = 'Add New Rule';
    addRuleBtn.textContent = 'Add Rule';
    cancelEditBtn.style.display = 'none';

    renderRules();
  }

  async function deleteRule(index) {
    if (confirm('Delete this rule?')) {
      rules.splice(index, 1);

      if (isEditing && editIndex === index) {
        cancelEdit();
      } else if (isEditing && editIndex > index) {
        editIndex--;
      }

      await saveRules();
      renderRules();
    }
  }

  async function clearAllRules() {
    if (confirm('Are you sure you want to delete ALL rules?')) {
      rules = [];
      cancelEdit();
      await saveRules();
      renderRules();
    }
  }

  async function testRule(domain) {
    const response = await chrome.runtime.sendMessage({ type: 'DIAGNOSE_RULE', domain });
    if (response) {
      const allowedIps = Array.isArray(response.allowedIps) ? response.allowedIps.join(', ') : 'None';
      alert(`Diagnostic for ${response.domain}:\n\n` +
            `Current IP: ${response.currentIp}\n` +
            `Provider: ${response.provider}\n` +
            `Lease Remaining: ${Math.round(response.leaseRemaining / 1000)}s\n` +
            `Rule Status: ${response.status}\n` +
            `Allowed IPs: ${allowedIps}`);
    }
  }

  async function saveRules() {
    rules = normalizeRulesArray(rules);
    await chrome.storage.local.set({ rules });
  }

  async function togglePanicMode() {
    panicMode = !panicMode;
    await chrome.storage.local.set({ panicMode });
    updatePanicButton();
  }

  async function saveSettings() {
    const timeoutSec = parseInt(leaseTimeoutInput.value, 10) || 5;
    const newSettings = {
      leaseTimeout: timeoutSec * 1000,
      webRtcDisabled: webrtcToggle.checked,
      autoClose: autoCloseToggle.checked,
      autoReload: autoReloadToggle.checked
    };

    const oldSettings = await chrome.storage.local.get('settings');
    const finalSettings = { ...oldSettings.settings, ...newSettings };

    await chrome.storage.local.set({ settings: finalSettings });

    const originalText = saveSettingsBtn.textContent;
    saveSettingsBtn.textContent = 'Saved!';
    setTimeout(() => {
      saveSettingsBtn.textContent = originalText;
    }, 1500);
  }

  function exportRules() {
    const data = {
      rules,
      settings,
      exportedAt: new Date().toISOString()
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
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
          const incomingRules = normalizeRulesArray(data.rules);
          if (confirm(`Import ${incomingRules.length} rules? This will MERGE with existing rules.`)) {
            const existing = new Map(normalizeRulesArray(rules).map(rule => [rule.domain, rule]));
            incomingRules.forEach(rule => {
              existing.set(rule.domain, { ...rule, id: Date.now() + Math.floor(Math.random() * 1000) });
            });

            rules = [...existing.values()];
            await saveRules();
            renderRules();
            alert(`Imported/updated ${incomingRules.length} rule(s).`);
          }
        } else {
          alert("Invalid format: 'rules' array missing.");
        }
      } catch (err) {
        alert('Error parsing JSON: ' + err.message);
      }
    };
    reader.readAsText(file);
    importFile.value = '';
  }
});
