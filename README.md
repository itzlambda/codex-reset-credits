# codex-reset-credits

Small command-line utility that shows Codex banked reset credits, their expiry times, and current Codex usage windows.

## What It Does

- Reads your local Codex auth file at `~/.codex/auth.json`.
- Uses the access token from that file to call `https://chatgpt.com/backend-api`.
- Calls these endpoints:
  - `/wham/rate-limit-reset-credits`
  - `/wham/usage`
- Prints available banked reset credits, the next expiry, per-credit expiry details, and usage reset windows.

## Requirements

- Codex CLI/Desktop already signed in on the machine.
- A readable auth file at `~/.codex/auth.json`.
- Node.js 18+.
