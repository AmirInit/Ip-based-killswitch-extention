const assert = require('assert');

// Mock state
let currentIp = "1.2.3.4";
let rules = [{ domain: "example.com", ips: ["1.2.3.4"] }];
let settings = { autoReload: true };

// Simulate CheckStatus
function checkStatus() {
    return rules[0].ips.includes(currentIp);
}

// Test 1: Initially Allowed
assert.strictEqual(checkStatus(), true);

// Test 2: IP Change -> Blocked
currentIp = "5.5.5.5";
assert.strictEqual(checkStatus(), false);

// Test 3: Auto-Reload Logic
// If settings.autoReload is true, and we become allowed, we redirect.
currentIp = "1.2.3.4";
if (settings.autoReload && checkStatus()) {
    console.log("Auto-Reload Triggered (Success)");
} else {
    assert.fail("Auto-Reload Failed");
}

console.log("Auto-Reload Logic Verified");
