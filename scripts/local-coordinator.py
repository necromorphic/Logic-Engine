#!/usr/bin/env python3
import json, subprocess, time, datetime, pathlib, sys
REPO='necromorphic/Logic-Engine'
OUT=pathlib.Path('coordinator-output')
INTERVAL=int(sys.argv[1]) if len(sys.argv)>1 else 300

def gh(args):
 p=subprocess.run(['gh',*args],text=True,capture_output=True,timeout=90)
 if p.returncode: raise RuntimeError((p.stderr or p.stdout).strip())
 return json.loads(p.stdout)
def snapshot():
 issues=gh(['issue','list','--repo',REPO,'--state','open','--limit','200','--json','number,title,body,labels,assignees,updatedAt,url'])
 prs=gh(['pr','list','--repo',REPO,'--state','open','--limit','100','--json','number,title,isDraft,headRefName,baseRefName,updatedAt,url,statusCheckRollup'])
 return issues,prs
def render(issues,prs):
 now=datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')
 blockers=[i for i in issues if any(k in (i.get('title','')+' '+i.get('body','')).lower() for k in ('blocker','fail-closed','production-readiness','release gate','non_ready'))]
 lines=['# Logic-Engine — local coordinator snapshot','',f'Generated: {now}','','> Read-only inventory: no assignments, comments, merges, code changes, or production-gate changes.','',f'## Counts\n- Open issues scanned: {len(issues)}\n- Open PRs scanned: {len(prs)}\n- Potential gate/blocker issues: {len(blockers)}','','## Priority signals']
 for i in sorted(blockers,key=lambda x:x.get('updatedAt',''),reverse=True):
  labels=', '.join(x['name'] for x in i.get('labels',[])) or 'no labels'; owners=', '.join(x['login'] for x in i.get('assignees',[])) or 'unassigned'
  lines.append(f"- [#{i['number']} {i['title']}]({i['url']}) — updated {i.get('updatedAt','unknown')}; {owners}; labels: {labels}")
 lines+=['','## Open pull requests']
 for p in prs: lines.append(f"- [{'DRAFT' if p.get('isDraft') else 'OPEN'} #{p['number']} {p['title']}]({p['url']}) — {p.get('headRefName')} → {p.get('baseRefName')}; updated {p.get('updatedAt','unknown')}")
 lines+=['','## All open issues']
 for i in sorted(issues,key=lambda x:x.get('updatedAt',''),reverse=True):
  owners=', '.join(x['login'] for x in i.get('assignees',[])) or 'unassigned'; lines.append(f"- [#{i['number']} {i['title']}]({i['url']}) — {owners}; updated {i.get('updatedAt','unknown')}")
 return '\n'.join(lines)+'\n'
def main():
 OUT.mkdir(exist_ok=True); print(f'Local coordinator polling every {INTERVAL}s; Ctrl+C to stop.')
 while True:
  try:
   issues,prs=snapshot(); report=render(issues,prs); stamp=datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
   (OUT/'latest.md').write_text(report,encoding='utf-8'); (OUT/f'snapshot-{stamp}.md').write_text(report,encoding='utf-8')
   print(f'[{datetime.datetime.now().isoformat(timespec="seconds")}] snapshot updated; issues={len(issues)} PRs={len(prs)}')
  except KeyboardInterrupt: break
  except Exception as e: print(f'ERROR: {e}',file=sys.stderr)
  time.sleep(max(60,INTERVAL))
if __name__=='__main__': main()
