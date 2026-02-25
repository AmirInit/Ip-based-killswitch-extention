# IP Kill Switch - Multi-IP Support (Manifest V3)

A privacy-focused Chrome Extension that enforces strict IP-based access control for specific domains. It features multi-IP whitelisting, strict leak prevention (block by default), WebRTC protection, and a Panic Mode.

## Features

- **Multi-IP Support:** Whitelist multiple IPs per domain.
- **Strict Leak Prevention:** Blocks target domains by default until your IP is verified.
- **Panic Mode:** Instantly blocks all internet access.
- **WebRTC Protection:** Disables WebRTC leaks by default.
- **Custom Block Page:** Clean, dark-themed page showing connection details.
- **Configurable:** Change IP detection API, toggle settings.

## Installation Instructions

1.  **Download/Clone** this repository.
2.  Open Chrome and navigate to `chrome://extensions`.
3.  Enable **Developer Mode** (toggle in the top right corner).
4.  Click **Load Unpacked**.
5.  Select the `src` folder from this project.
6.  The extension is now active.

## Usage

1.  Click the extension icon to open the popup.
2.  **Add Rule:** Enter a domain (e.g., `example.com`) and allowed IPs (e.g., `1.2.3.4, 5.6.7.8`).
3.  **Status:** The popup shows your current detected IP.
4.  **Verification:** Visit the domain.
    -   If your IP matches, the site loads.
    -   If not, you see the Blocked Page.
5.  **Panic Mode:** Click the "PANIC MODE" button to block all traffic immediately.

## Configuration

-   **IP Detection API:** Defaults to `https://api.ipify.org`. You can change this in the "Advanced Settings" section of the popup.
-   **WebRTC:** Enabled by default (Disable WebRTC). Can be toggled in settings.
-   **Auto-Close:** Automatically close tabs that are blocked (Settings).
