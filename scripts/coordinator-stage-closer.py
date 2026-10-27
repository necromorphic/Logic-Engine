#!/usr/bin/env python3
"""Close explicitly opted-in Logic-Engine stages only after executable evidence passes.

This is a deterministic evidence gate, not an LLM coordinator. It never assigns,
merges, changes source, or changes production Memory→NPC gates.
"""
import json
import re
import subprocess
import sys

REPO = "necromorphic/Logic-Engine"
AUTO_LABEL = "stage:auto-close"
READY_MARKER = "<!-- stage-status: READY_TO_CLOSE -->"
PR_URL = re.compile(r"https://github\.com/necromorphic/Logic-Engine/pull/(\d+)(?:[/?#][^\s)]*)?")
CHECKED = re.compile(r"^\s*[-*]\s+\[[xX]\]", re.MULTILINE)
UNCHECKED = re.compile(r"^\s*[-*]\s+\[\s\]", re.MULTILINE)


def gh(args):
    result = subprocess.run(
        ["gh", *args], text=True, encoding="utf-8", errors="replace",
        capture_output=True, timeout=90,
    )
    if result.returncode:
        raise RuntimeError((result.stderr or result.stdout).strip())
    return json.loads(result.stdout) if result.stdout.strip() else None


def labels(issue):
    return {item.get("name", "").casefold() for item in issue.get("labels", [])}


def linked_pr_numbers(body):
    return sorted({int(match.group(1)) for match in PR_URL.finditer(body or "")})


def check_rollup_is_green(checks):
    if not isinstance(checks, list) or not checks:
        return False
    for check in checks:
        if not isinstance(check, dict):
            return False
        conclusion = str(check.get("conclusion") or "").upper()
        state = str(check.get("state") or "").upper()
        if conclusion != "SUCCESS" and state != "SUCCESS":
            return False
    return True


def issue_ready(issue, pull_requests):
    """Return (eligible, reason); no network calls are performed here."""
    if str(issue.get("state", "OPEN")).upper() != "OPEN":
        return False, "issue is not open"
    if AUTO_LABEL not in labels(issue):
        return False, "missing explicit stage:auto-close label"
    body = issue.get("body") or ""
    if READY_MARKER not in body:
        return False, "missing explicit READY_TO_CLOSE marker"
    if UNCHECKED.search(body):
        return False, "acceptance checklist has unchecked items"
    if not CHECKED.search(body):
        return False, "no checked acceptance item was found"
    numbers = linked_pr_numbers(body)
    if not numbers:
        return False, "no exact repository PR URL found in issue body"
    if set(pull_requests) != set(numbers):
        return False, "PR evidence is incomplete"
    for number in numbers:
        pr = pull_requests[number]
        if not pr.get("mergedAt"):
            return False, f"PR #{number} is not merged"
        if not check_rollup_is_green(pr.get("statusCheckRollup")):
            return False, f"PR #{number} has missing or non-green exact-head checks"
    return True, "all declared acceptance and exact-head evidence gates passed"


def issue_list():
    result = gh([
        "issue", "list", "--repo", REPO, "--state", "open", "--limit", "200",
        "--json", "number,title,body,state,labels,url",
    ])
    if not isinstance(result, list):
        raise ValueError("GitHub CLI returned unexpected issue data")
    return result


def pull_request(number):
    result = gh([
        "pr", "view", str(number), "--repo", REPO,
        "--json", "number,state,mergedAt,headRefOid,statusCheckRollup,url",
    ])
    if not isinstance(result, dict):
        raise ValueError(f"GitHub CLI returned unexpected PR data for #{number}")
    return result


def close_eligible_stages():
    closed = []
    for issue in issue_list():
        if AUTO_LABEL not in labels(issue):
            continue
        numbers = linked_pr_numbers(issue.get("body") or "")
        evidence = {number: pull_request(number) for number in numbers}
        eligible, reason = issue_ready(issue, evidence)
        if not eligible:
            print(f"KEEP OPEN #{issue.get('number')}: {reason}")
            continue
        commits = ", ".join(
            f"PR #{number} head {evidence[number].get('headRefOid', 'unknown-head')}"
            for number in numbers
        )
        comment = (
            "Automatically closed by the local evidence gate.\n\n"
            f"Acceptance marker and checklist passed. Exact-head PR checks are green: {commits}.\n"
            "This closes the tracking stage only; it does not enable Memory→NPC or change production gates."
        )
        gh([
            "issue", "close", str(issue["number"]), "--repo", REPO,
            "--reason", "completed", "--comment", comment,
        ])
        closed.append(issue["number"])
        print(f"CLOSED #{issue['number']}: {reason}")
    return closed


if __name__ == "__main__":
    try:
        close_eligible_stages()
    except Exception as exc:
        print(f"Stage closer failed safely: {exc}", file=sys.stderr)
        raise SystemExit(2)
