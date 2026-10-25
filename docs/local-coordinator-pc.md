# Local Logic-Engine Coordinator (Windows PC)

This is the first runnable local coordinator slice. It polls GitHub from your PC and maintains a timestamped portfolio snapshot. The initial monitor is read-only: it does not assign issues, post comments, merge PRs, or change production gates.

## One-time setup

1. Install GitHub CLI (gh) and Python 3.11+ on Windows.
2. Open PowerShell and authenticate with `gh auth login`. Choose GitHub.com and HTTPS, then complete browser login. Never paste a token into this project or chat.
3. Clone/download this repository and open PowerShell in the folder containing `scripts/local-coordinator.py`.
4. Run `python .\\scripts\\local-coordinator.py`. Optional interval: `python .\\scripts\\local-coordinator.py 300` (seconds; minimum 60).
5. Read `coordinator-output\\latest.md`. Keep the terminal open while it runs.

## Semi-automatic task queue (first slice)

In a second PowerShell window, from the same repository folder, run:

```powershell
python .\\scripts\\coordinator-queue.py
```

The queue generator reads current open issues directly through the authenticated GitHub CLI and writes `coordinator-output\\next-actions.md`. It uses conservative text/label signals to suggest a review order; this is a heuristic, not a dependency solver or an LLM judgment. Inspect the linked issue and its current comments/PRs before acting.

## Safety boundaries

- This PC must be on and connected to the internet.
- GitHub CLI must have read access to `necromorphic/Logic-Engine`.
- Neither script sends tasks to ChatGPT module chats or publishes GitHub comments. They do not assign issues, merge PRs, change source code in engine modules, or change production gates.
- Memory→NPC remains disabled/fail-closed until real-path evidence proves source authority, version/lineage, inventory, reconciliation, and revocation.
- Do not modify `src/endpoints/vectors.js`, `src/vectors/ollama-vectors.js`, or `src/vectors/remote-store.js`; the existing vectorization bridge is out of scope.
- Do not set PR #272's webhook secret to a guessed/local URL. A PC behind a home router is not directly reachable by GitHub without a secure relay/tunnel.

## Next increment

Generate structured task packets from the selected issue (objective, dependencies, allowed/forbidden scope, acceptance criteria, evidence links, stop conditions), then add an explicit approval step before publishing a task to a supported external channel. Full dispatch to separate ChatGPT chats requires an available, authorized agent interface; do not simulate this with comments or claim dispatch occurred.
