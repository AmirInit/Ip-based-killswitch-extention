const assert = require('assert');

// CIDR Logic
function ipInCidr(ip, cidr) {
    try {
        const [range, bitsStr] = cidr.split('/');
        const bits = parseInt(bitsStr, 10);
        if (isNaN(bits) || bits < 0 || bits > 32) return false;

        const ipv4Regex = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/;
        if (!ipv4Regex.test(range) || !ipv4Regex.test(ip)) return false;

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
assert.ok(ipInCidr("192.168.1.5", "192.168.1.0/24"), "CIDR Match Failed");
assert.ok(!ipInCidr("192.168.2.5", "192.168.1.0/24"), "CIDR No-Match Failed");
assert.ok(ipInCidr("10.0.0.1", "10.0.0.0/8"), "CIDR /8 Match Failed");

// Hardening Tests
assert.ok(!ipInCidr("2001:db8::1", "2001:db8::/32"), "IPv6 Should Fail");
assert.ok(!ipInCidr("192.168.1.5", "192.168.1.0/33"), "Invalid Bits Should Fail");
assert.ok(!ipInCidr("192.168.1.5", "192.168.1.0/-1"), "Negative Bits Should Fail");

console.log("CIDR Tests Passed!");
