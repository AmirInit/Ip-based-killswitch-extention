# IP Kill Switch - Multi-IP Support (Manifest V3)

A robust, fail-closed privacy tool for Chrome that whitelists specific IPs for sensitive domains.

## Features

- **Strict Leak Prevention:** Uses `declarativeNetRequest` to BLOCK/REDIRECT by default.
- **Fail-Closed Lease:** If IP detection fails or hangs for >5 seconds, all rules revert to BLOCK.
- **High-Frequency Checks:** Checks IP every ~1s using an Offscreen Document.
- **Multi-Provider Failover:** Rotates between 6+ IP providers (ipify, ifconfig, etc.) to avoid outages.
- **Multi-IP Support:** Whitelist multiple comma-separated IPs per domain.
- **CIDR Support:** Whitelist IPv4 ranges (e.g., `192.168.1.0/24`).
- **Panic Mode:** Instantly severs all internet access.
- **Auto-Reload:** Automatically retries blocked tabs when your IP becomes valid (configurable).
- **Import/Export:** Share rules easily.

## Installation

1.  **Clone/Download** this repository.
2.  Open Chrome → `chrome://extensions`.
3.  Enable **Developer Mode**.
4.  Click **Load Unpacked**.
5.  Select the `src` folder.

## Usage

1.  **Add Rules:**
    -   Enter `example.com`.
    -   Enter IPs: `1.2.3.4, 10.0.0.0/24`.
    -   Click "Add Rule".
2.  **Verify:**
    -   Popup shows "Current IP" in Green.
    -   Visit `example.com`.
    -   If IP matches, it loads. If not, you see the Blocked Page.
    -   **Note:** Subresources (images, API calls) on background tabs are silently blocked if IP mismatches.
3.  **Panic Mode:**
    -   Click "PANIC MODE" in popup to kill all connections immediately.

## Configuration (Advanced)

-   **Lease Timeout:** How long an IP check is valid. Default 5s. Lower = stricter but more sensitive to network blips.
-   **WebRTC:** Disabled by default to prevent leaks.
-   **Auto-Close:** Automatically close tabs that are blocked.
-   **Auto-Reload:** Automatically retry when unblocked.

## Troubleshooting

-   **"Extension failed to load":** Ensure you are loading the `src` folder, not the root.
-   **"Blocked" page keeps showing:** Check your IP. Click "Test Rule" in the popup to see why.
