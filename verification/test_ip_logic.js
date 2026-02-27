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

console.log("Logic tests passed!");
