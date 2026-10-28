#!/usr/bin/env python3
"""Build a human-approved next-action queue from live GitHub issue data.

Requires GitHub CLI (gh) authenticated on the PC. Read-only: no assignment,
comments, merges, code changes, or production-gate changes.
"""
import json
import pathlib
import subprocess
import sys

REPO = "necromorphic/Logic-Engine"
OUT = pathlib.Path("coordinator-output")
GATE_TERMS = (
    "fail-closed", "production-readiness", "release gate", "non_ready",
    "authority", "reconciliation", "revocation", "lineage", "inventory",
)
BLOCKED_TERMS = ("memory→npc", "memory->npc", "memory to npc")


def fetch_issues():
    result = subprocess.run(
        ["gh", "issue", "list", "--repo", REPO, "--state", "open",
         "--limit", "200", "--json",
         "number,title,body,labels,assignees,updatedAt,url"],
        text=True, encoding="utf-8", errors="replace",
        capture_output=True, timeout=90,
    )
    if result.returncode:
        raise RuntimeError((result.stderr or result.stdout).strip())
    data = json.loads(result.stdout)
    if not isinstance(data, list):
        raise ValueError("GitHub CLI returned unexpected issue data")
    return data


def score(issue):
    text = (issue.get("title", "") + "\n" + issue.get("body", "")).lower()
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
    try:
        issues = fetch_issues()
    except Exception as exc:
        print(f"Cannot build queue: {exc}", file=sys.stderr)
        return 2

    rows = []
    for issue in issues:
        value, reasons = score(issue)
        if value:
            rows.append((value, issue, reasons))
    rows.sort(key=lambda row: (-row[0], row[1].get("updatedAt", "")))

    lines = [
        "# Coordinator — human approval queue", "",
        "> Suggested order only. Nothing is assigned, dispatched, merged, or authorized automatically.",
        "> Memory→NPC remains disabled/fail-closed until required production evidence is independently verified.",
        f"> Repository: {REPO}", f"> Open issues scanned: {len(issues)}", "",
    ]
    if not rows:
        lines += ["No candidate issues matched the conservative queue rules.", ""]
    for value, issue, reasons in rows:
        lines += [
            f"## [#{issue.get('number', '?')} — {issue.get('title', '(untitled)')}]({issue.get('url', '')})",
            f"- Priority score: {value}",
            "- Signals: " + "; ".join(reasons),
            "- Human action: inspect current comments, linked PRs, and exact-head evidence before assigning work.",
            "- Task packet must state objective, prerequisites, allowed/forbidden scope, acceptance criteria, evidence links, and stop conditions.",
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
