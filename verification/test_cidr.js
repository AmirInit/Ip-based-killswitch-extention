const assert = require('assert');

function isValidIpv4(ip) {
  return /^(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(ip || '');
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

assert.ok(ipInCidr('192.168.1.5', '192.168.1.0/24'));
assert.ok(!ipInCidr('192.168.2.5', '192.168.1.0/24'));
assert.ok(ipInCidr('10.0.0.1', '10.0.0.0/8'));
assert.ok(ipInCidr('8.8.8.8', '0.0.0.0/0'));
assert.ok(!ipInCidr('300.1.1.1', '10.0.0.0/8'));
assert.ok(!ipInCidr('1.2.3.4', '1.2.3.0/33'));
assert.ok(!ipInCidr('1.2.3.4', '1.2.3.0/-1'));
assert.ok(!ipInCidr('1.2.3.4', 'bad/24'));

console.log('CIDR Tests Passed!');
