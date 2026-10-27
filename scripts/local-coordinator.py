#!/usr/bin/env python3
import json
import pathlib
import subprocess
import sys
import time
import datetime

REPO = "necromorphic/Logic-Engine"
OUT = pathlib.Path("coordinator-output")
arguments = [arg for arg in sys.argv[1:] if arg != "--auto-close-stages"]
INTERVAL = int(arguments[0]) if arguments else 300
AUTO_CLOSE_STAGES = "--auto-close-stages" in sys.argv[1:]


def gh(args):
    result = subprocess.run(
        ["gh", *args], text=True, encoding="utf-8", errors="replace",
        capture_output=True, timeout=90,
    )
    if result.returncode:
        raise RuntimeError((result.stderr or result.stdout).strip())
    return json.loads(result.stdout)


def snapshot():
    issues = gh([
        "issue", "list", "--repo", REPO, "--state", "open", "--limit", "200",
        "--json", "number,title,body,labels,assignees,updatedAt,url",
    ])
    prs = gh([
        "pr", "list", "--repo", REPO, "--state", "open", "--limit", "100",
        "--json", "number,title,isDraft,headRefName,baseRefName,updatedAt,url,statusCheckRollup",
    ])
    return issues, prs


def render(issues, prs):
    now = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
    blockers = [
        issue for issue in issues
        if any(term in (issue.get("title", "") + " " + issue.get("body", "")).lower()
               for term in ("blocker", "fail-closed", "production-readiness", "release gate", "non_ready"))
    ]
    lines = [
        "# Logic-Engine — local coordinator snapshot", "",
        f"Generated: {now}", "",
        "> Read-only inventory. Optional stage auto-closure is separately gated by explicit issue opt-in, a completion marker, a checked checklist, merged PRs, and green exact-head checks.", "",
        f"## Counts\n- Open issues scanned: {len(issues)}\n- Open PRs scanned: {len(prs)}\n- Potential gate/blocker issues: {len(blockers)}", "",
        "## Priority signals",
    ]
    for issue in sorted(blockers, key=lambda item: item.get("updatedAt", ""), reverse=True):
        issue_labels = ", ".join(item["name"] for item in issue.get("labels", [])) or "no labels"
        owners = ", ".join(item["login"] for item in issue.get("assignees", [])) or "unassigned"
        lines.append(
            f"- [#{issue['number']} {issue['title']}]({issue['url']}) — "
            f"updated {issue.get('updatedAt', 'unknown')}; {owners}; labels: {issue_labels}"
        )
    lines += ["", "## Open pull requests"]
    for pr in prs:
        state = "DRAFT" if pr.get("isDraft") else "OPEN"
        lines.append(
            f"- [{state} #{pr['number']} {pr['title']}]({pr['url']}) — "
            f"{pr.get('headRefName')} → {pr.get('baseRefName')}; updated {pr.get('updatedAt', 'unknown')}"
        )
    lines += ["", "## All open issues"]
    for issue in sorted(issues, key=lambda item: item.get("updatedAt", ""), reverse=True):
        owners = ", ".join(item["login"] for item in issue.get("assignees", [])) or "unassigned"
        lines.append(f"- [#{issue['number']} {issue['title']}]({issue['url']}) — {owners}; updated {issue.get('updatedAt', 'unknown')}")
    return "\n".join(lines) + "\n"


def run_stage_closer():
    script = pathlib.Path(__file__).with_name("coordinator-stage-closer.py")
    result = subprocess.run(
        [sys.executable, str(script)], text=True, encoding="utf-8",
        errors="replace", capture_output=True, timeout=180,
    )
    if result.stdout:
        print(result.stdout.rstrip())
    if result.returncode:
        detail = (result.stderr or result.stdout).strip()
        raise RuntimeError(detail or f"stage closer exited with {result.returncode}")


def main():
    OUT.mkdir(exist_ok=True)
    print(f"Local coordinator polling every {INTERVAL}s; Ctrl+C to stop.")
    if AUTO_CLOSE_STAGES:
        print("Evidence-gated stage auto-closure is ON; only explicitly opted-in stages can close.")
    while True:
        try:
            issues, prs = snapshot()
            report = render(issues, prs)
            stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
            (OUT / "latest.md").write_text(report, encoding="utf-8")
            (OUT / f"snapshot-{stamp}.md").write_text(report, encoding="utf-8")
            print(f"[{datetime.datetime.now().isoformat(timespec='seconds')}] snapshot updated; issues={len(issues)} PRs={len(prs)}")
            if AUTO_CLOSE_STAGES:
                try:
                    run_stage_closer()
                except Exception as exc:
                    print(f"STAGE CLOSER ERROR (monitor continues; no unsafe fallback): {exc}", file=sys.stderr)
        except KeyboardInterrupt:
            break
        except Exception as exc:
            print(f"ERROR: {exc}", file=sys.stderr)
        time.sleep(max(60, INTERVAL))


if __name__ == "__main__":
    main()
