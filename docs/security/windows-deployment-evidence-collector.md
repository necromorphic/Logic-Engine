# Windows deployment evidence collector

Read-only evidence collection for the Logic Engine Security deployment review. This script does not change ACLs, firewall rules, services, databases, or network configuration.

## Run

Open PowerShell. Supply exact database and backup paths already known to the operator; optionally supply PIDs for Core, Provider, or gateway processes. Example:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\security\Collect-DeploymentEvidence.ps1 `
  -DataPath @('C:\\LogicEngine\\data\\logic-engine.sqlite','C:\\Provider\\data\\memory.sqlite','C:\\Coordinator\\coordinator.sqlite') `
  -BackupPath @('D:\\Backups\\LogicEngine','D:\\Backups\\Provider') `
  -ProcessId @(1234, 5678) `
  -OutputPath '.\\security-deployment-audit.json'
```

Replace example paths and PIDs with the actual deployment values. The script intentionally does not record process command lines or environment variables because they may contain credentials. It records process executable paths/owners; ACLs and SDDL for supplied paths and parent directories; SQLite sidecars; recursive ACL evidence for files and directories under each supplied backup directory; established TCP connections; active firewall profile defaults; and enabled outbound allow/block rules. If a backup tree cannot be fully enumerated or a path/ACL query fails, the report must be treated as incomplete and the affected entry reviewed manually. A path lookup error is represented as unknown, not silently treated as absent.

## Evidence limits

This is an inventory collector, not a security acceptance test. It does not prove:
- that every protected request uses the gateway;
- that direct upstream egress is blocked;
- that Core/Provider/gateway identities cannot bypass each other's filesystem ACLs;
- that the accepted-head authority is restore-independent;
- that revocation before dispatch-start causes zero transport invocations.

Those require separate negative tests and an approved deployment diff. Review the JSON locally and redact machine/user names, paths, and remote endpoints before sharing it. Do not include secrets or raw prompt/message content.

Status remains NON_READY; Memory→NPC remains DISABLED / FAIL-CLOSED until the full acceptance gates pass.
