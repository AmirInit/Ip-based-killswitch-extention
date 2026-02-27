const assert = require('assert');

const currentIp = '1.2.3.4';
const ruleIpsMessy = [' 1.2.3.4 ', '5.6.7.8\n'];
const cleaned = ruleIpsMessy.map(i => i.trim());
assert.ok(cleaned.includes(currentIp), 'Trimmed match failed');

const providers = [
  { key: 'ifconfig', tier: 3 },
  { key: 'aws', tier: 2 },
  { key: 'ipify', tier: 1 },
  { key: 'ipify64', tier: 1 }
];

const health = {
  ipify: { failures: 1, lastSuccess: 1 },
  ipify64: { failures: 0, lastSuccess: 2 },
  aws: { failures: 0, lastSuccess: 0 },
  ifconfig: { failures: 0, lastSuccess: 0 }
};

const sorted = [...providers].sort((a, b) => {
  if (a.tier !== b.tier) return a.tier - b.tier;
  const hA = health[a.key] || { failures: 0, lastSuccess: 0 };
  const hB = health[b.key] || { failures: 0, lastSuccess: 0 };
  if (hA.failures !== hB.failures) return hA.failures - hB.failures;
  return hB.lastSuccess - hA.lastSuccess;
});

assert.strictEqual(sorted[0].key, 'ipify64');
assert.strictEqual(sorted[1].tier, 1);
assert.strictEqual(sorted[2].tier, 2);
assert.strictEqual(sorted[3].tier, 3);

console.log('Logic tests passed!');
