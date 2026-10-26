#!/usr/bin/env bash
set -euo pipefail

EXPECTED_SHA="06bde939fb1e9c4c8d8641d810f0a916b5bce127"
ROOT="${1:-.}"

if ! command -v rg >/dev/null 2>&1; then
  echo "ERROR: ripgrep (rg) is required" >&2
  exit 2
fi
if ! command -v git >/dev/null 2>&1; then
  echo "ERROR: git is required" >&2
  exit 2
fi
ACTUAL_SHA="$(git -C "$ROOT" rev-parse HEAD)"
printf 'expected_sha=%s\nactual_sha=%s\n' "$EXPECTED_SHA" "$ACTUAL_SHA"
if [[ "$ACTUAL_SHA" != "$EXPECTED_SHA" ]]; then
  echo "BLOCKED: checkout is not the approved pinned SillyTavern SHA; no audit counts emitted." >&2
  exit 3
fi

cd "$ROOT"
echo
echo '=== Scope and limitations ==='
echo 'Static lexical inventory only. Hits are not unique model calls and do not prove runtime reachability.'
echo 'Counts include local inference, provider discovery/status/poll/abort, media, vectorization and unrelated requests.'
echo 'Do not use this report to claim exhaustive coverage or authorization. Review every hit and enabled extension/custom route.'
echo

echo '=== Outbound/client transport call-site hits (tracked source; generated/dependency dirs excluded) ==='
rg -n --hidden --glob '!node_modules/**' --glob '!public/lib/**' --glob '!dist/**' --glob '!coverage/**' \
  '(^|[^[:alnum:]_])(fetch|axios|got|undici|request)\s*\(|https?\.request\s*\(|new WebSocket\s*\(|WebSocket\(' \
  public src server.js plugins.js 2>/dev/null || true

echo
echo '=== Server route declarations (review candidates, not all are inference routes) ==='
rg -n --hidden --glob '!node_modules/**' --glob '!public/lib/**' --glob '!dist/**' --glob '!coverage/**' \
  '(router|[[:alnum:]_]+Router|[[:alnum:]_]+)\.(post|get|put|delete|patch)\s*\(' src/endpoints 2>/dev/null || true

echo
echo '=== Provider/media/local-inference route markers ==='
rg -n --hidden --glob '!node_modules/**' --glob '!public/lib/**' --glob '!dist/**' --glob '!coverage/**' \
  'generate|completion|chat/completions|messages/create|image-to-text|caption-image|transcri|speech|tts|embedding|embed|inference|predict|rerank|translate|vectors' \
  src/endpoints public/scripts/extensions/tts public/scripts/extensions/stable-diffusion public/scripts/openai.js public/scripts/textgen-settings.js 2>/dev/null || true

echo
echo '=== Required interpretation ==='
echo '1. Manually classify each hit as protected-content-capable, discovery/status/poll/abort, media, local inference, vectorization, or unrelated.'
echo '2. Trace browser caller -> local route -> every provider branch -> final transport.'
echo '3. Unclassified or untested paths remain UNSUPPORTED / FAIL-CLOSED for protected Memory→NPC material.'
echo '4. Do not modify existing vectorization/remote-store files as part of this audit.'
