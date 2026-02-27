// verification/test_ip_logic.js

const assert = require('assert');

// Mock Data
const currentIp = "1.2.3.4";
const ruleIps = ["1.2.3.4", "5.6.7.8"];
const ruleIpsMessy = [" 1.2.3.4 ", "5.6.7.8\n"];

// Test 1: Exact Match
assert.ok(ruleIps.includes(currentIp), "Exact match failed");

// Test 2: Messy Match (Clean logic)
const cleaned = ruleIpsMessy.map(i => i.trim());
assert.ok(cleaned.includes(currentIp), "Trimmed match failed");

// Test 3: Failover Logic (Simulation)
const providers = ["A", "B", "C"];
let health = { "A": { failures: 5 }, "B": { failures: 0 } };

const sorted = [...providers].sort((a, b) => {
    const hA = health[a] || { failures: 0 };
    const hB = health[b] || { failures: 0 };
    return hA.failures - hB.failures;
});

// Expect B (0 failures) -> C (0 failures, implicit) -> A (5 failures)
assert.strictEqual(sorted[0], "B");
assert.strictEqual(sorted[2], "A");

console.log("Logic tests passed!");
