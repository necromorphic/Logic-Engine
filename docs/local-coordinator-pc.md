 # Local Logic-Engine Coordinator (Windows PC)

This is the first runnable local coordinator slice. It polls the repository from your PC and maintains a timestamped portfolio snapshot. It is deliberately read-only: it does not assign issues, post comments, merge PRs, or change production gates.

## One-time setup

1. Install GitHub CLI (gh) and Python 3.11+ on Windows.
2. Open PowerShell and authenticate with `gh auth login`. Choose GitHub.com and HTTPS, then complete browser login. Never paste a token into this project or chat.
3. Clone/download this repository and open PowerShell in the folder containing `scripts/local-coordinator.py`.
4. Run `python .\\scripts\\local-coordinator.py`. Optional interval: `python .\\scripts\\local-coordinator.py 300` (seconds; minimum 60).
5. Read `coordinator-output\\latest.md`. Keep the terminal open while it runs.

## Current limits

- This PC must be on and connected to the internet.
- GitHub CLI must have read access to `necromorphic/Logic-Engine`.
- This version is a read-only inventory monitor, not yet an LLM-driven agent. It does not require a webhook or public server.
- Do not set PR #272's webhook secret to a guessed/local URL. A PC behind a home router is not directly reachable by GitHub without a secure relay/tunnel.
- Next increment: evidence extraction and decision queue. Write-capable automation requires scoped credentials, audit logs, and approval gates.
