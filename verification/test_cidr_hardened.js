const assert = require('assert');

// CIDR Logic
function ipInCidr(ip, cidr) {
    if (!ip || !cidr) return false;
    const ipRegex = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/;
    if (!ipRegex.test(ip)) return false;

    try {
        const parts = cidr.split('/');
        if (parts.length !== 2) return false;

        const range = parts[0];
        const bits = parseInt(parts[1], 10);

        if (isNaN(bits) || bits < 0 || bits > 32) return false;
        if (!ipRegex.test(range)) return false;

        const mask = ~(2**(32 - bits) - 1);
        return (ipToLong(ip) & mask) === (ipToLong(range) & mask);
    } catch(e) {
        return false;
    }
}

function ipToLong(ip) {
    return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
}

// Tests
assert.ok(ipInCidr("192.168.1.5", "192.168.1.0/24"), "Valid Match");
assert.ok(!ipInCidr("192.168.2.5", "192.168.1.0/24"), "Valid Mismatch");
assert.ok(!ipInCidr("1.2.3.4", "1.2.3.4/33"), "Invalid Bits (>32)");
assert.ok(!ipInCidr("1.2.3.4", "1.2.3.4/-1"), "Invalid Bits (<0)");
assert.ok(!ipInCidr("1.2.3.4", "invalid/24"), "Invalid Range IP");
assert.ok(!ipInCidr("::1", "1.2.3.4/24"), "IPv6 Input (Should Fail)");

console.log("Hardened CIDR Tests Passed!");
