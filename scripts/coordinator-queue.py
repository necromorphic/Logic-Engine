#!/usr/bin/env python3
"""Build a human-approved next-action queue from the local coordinator snapshot.

This helper does not call an LLM, assign issues, post comments, merge PRs, or
change production gates. It ranks candidates for a person to review.
"""
import json
import pathlib
import re
import sys

REPO = "necromorphic/Logic-Engine"
OUT = pathlib.Path("coordinator-output")
GATE_TERMS = (
    "fail-closed", "production-readiness", "release gate", "non_ready",
    "authority", "reconciliation", "revocation", "lineage", "inventory",
)
BLOCKED_TERMS = ("memory→npc", "memory->npc", "memory to npc")
EXCLUDED_PATHS = {
    "src/endpoints/vectors.js",
    "src/vectors/ollama-vectors.js",
    "src/vectors/remote-store.js",
}


def load_snapshot(path):
    # Deliberately consume the monitor's structured GitHub CLI export rather
    # than scraping rendered Markdown. The monitor can write this JSON export.
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or not isinstance(data.get("issues"), list):
        raise ValueError("Snapshot must be JSON with an 'issues' array")
    return data


def score(issue):
    title = issue.get("title", "")
    body = issue.get("body", "")
    text = (title + "\n" + body).lower()
    labels = {x.get("name", "").lower() for x in issue.get("labels", [])}
    score = 0
    reasons = []
    if labels & {"blocker", "blocked", "integration", "coordinator"}:
        score += 4
        reasons.append("coordination/blocker label")
    matched = [term for term in GATE_TERMS if term in text]
    if matched:
        score += 3
        reasons.append("gate evidence: " + ", ".join(matched[:4]))
    if any(term in text for term in BLOCKED_TERMS):
        score += 2
        reasons.append("Memory→NPC safety boundary")
    if not issue.get("assignees"):
        score += 1
        reasons.append("unassigned")
    return score, reasons


def main():
    path = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else OUT / "issues.json"
    try:
        data = load_snapshot(path)
    except Exception as exc:
        print(f"Cannot build queue: {exc}", file=sys.stderr)
        return 2

    rows = []
    for issue in data["issues"]:
        value, reasons = score(issue)
        if value:
            rows.append((value, issue, reasons))
    rows.sort(key=lambda row: (-row[0], row[1].get("updatedAt", "")))

    lines = [
        "# Coordinator — human approval queue", "",
        "> Suggested order only. Nothing is assigned, dispatched, merged, or authorized automatically.",
        "> Memory→NPC remains disabled/fail-closed until the required production evidence is independently verified.",
        f"> Repository: {REPO}", "",
    ]
    if not rows:
        lines += ["No candidate issues matched the conservative queue rules.", ""]
    for value, issue, reasons in rows:
        number = issue.get("number", "?")
        title = issue.get("title", "(untitled)")
        url = issue.get("url", "")
        lines += [
            f"## [{number} — {title}]({url})",
            f"- Priority score: {value}",
            "- Signals: " + "; ".join(reasons),
            "- Human action: inspect current comments, linked PRs, and exact-head evidence before assigning work.",
            "- Required packet: objective, prerequisites, files/scope allowed, forbidden scope, acceptance criteria, evidence links, stop conditions.",
            "- Stop condition: if source authority, version/lineage, inventory, reconciliation, or revocation is unknown, mark BLOCKED; do not enable Memory→NPC.",
            "",
        ]
    OUT.mkdir(parents=True, exist_ok=True)
    target = OUT / "next-actions.md"
    target.write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote {target} with {len(rows)} candidate(s). Human approval required.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
