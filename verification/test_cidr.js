const assert = require('assert');

// CIDR Logic
function ipInCidr(ip, cidr) {
    try {
        const [range, bits] = cidr.split('/');
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

console.log("CIDR Tests Passed!");
