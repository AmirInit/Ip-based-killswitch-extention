# IP Kill Switch - Multi-IP Support (Manifest V3)

A robust, fail-closed privacy tool for Chrome that whitelists specific IPs for sensitive domains.

## Features

- **Strict Leak Prevention:** Uses `declarativeNetRequest` to BLOCK/REDIRECT by default.
- **Fail-Closed Lease:** If IP detection fails or hangs for >5 seconds, all rules revert to BLOCK.
- **High-Frequency Checks:** Checks IP every ~1s using an Offscreen Document.
- **Multi-Provider Failover:** Rotates between 6+ IP providers (ipify, ifconfig, etc.) to avoid outages.
- **Multi-IP Support:** Whitelist multiple comma-separated IPs per domain.
- **Panic Mode:** Instantly severs all internet access.

## Installation

1.  **Clone/Download** this repository.
2.  Open Chrome → `chrome://extensions`.
3.  Enable **Developer Mode**.
4.  Click **Load Unpacked**.
5.  Select the `src` folder.

## Usage

1.  **Add Rules:**
    -   Enter `example.com` and `1.2.3.4, 5.6.7.8`.
    -   Click "Add Rule".
2.  **Verify:**
    -   Popup shows "Current IP" in Green.
    -   Visit `example.com`.
3.  **Panic Mode:**
    -   Click "PANIC MODE" in popup to kill all connections immediately.

## Configuration (Advanced)

-   **Lease Timeout:** How long an IP check is valid. Default 5s. Lower = stricter but more sensitive to network blips.
-   **WebRTC:** Disabled by default to prevent leaks.
