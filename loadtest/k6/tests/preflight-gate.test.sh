#!/usr/bin/env bash
# Regression test for the production gate's preflight-stamp lifecycle (main.js + lib/config.js).
#
# Runs the REAL suite in Docker (grafana/k6) against a FAKE local HTTPS API that the container
# resolves as api.patheyaexpress.com (--add-host ... :host-gateway), so the production gate is
# genuinely engaged while no request ever reaches production. Needs docker, node and openssl.
#
#   bash loadtest/k6/tests/preflight-gate.test.sh        (~3 minutes: one 2m10s smoke run)
#
# Proves:
#   1. a valid stamp lets setup() run, and a run that outlives the 15-minute stamp still produces
#      its end-of-test summary (stamp 880 s old at start -> ~1020 s at summary time);
#   2. a missing stamp and an expired stamp are rejected before ANY request (fake API sees 0);
#   3. CONFIRM_PRODUCTION=I_UNDERSTAND is still required (rejected before any request).
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE="${K6_IMAGE:-grafana/k6:2.3.0}"
PORT="${FAKE_API_PORT:-18443}"
BASE_URL="https://api.patheyaexpress.com:${PORT}"
WORK="$(mktemp -d)"
export MSYS_NO_PATHCONV=1

cleanup() { [[ -n "${SERVER_PID:-}" ]] && kill "$SERVER_PID" 2>/dev/null; rm -rf "$WORK"; }
trap cleanup EXIT

# Suite copy, so results/ (stamp + summaries) never touches the repository.
mkdir -p "$WORK/suite/results"
cp -r "$ROOT/main.js" "$ROOT/lib" "$WORK/suite/"
# Native-path helper: Git for Windows' node/openssl/docker need C:\... paths (cygpath); no-op elsewhere.
win() { if command -v cygpath >/dev/null; then cygpath -w "$1"; else echo "$1"; fi; }
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj "/CN=api.patheyaexpress.com" \
  -keyout "$(win "$WORK/key.pem")" -out "$(win "$WORK/cert.pem")" >/dev/null 2>&1 \
  || { echo "FAIL  could not create the test certificate (openssl)"; exit 1; }

cat > "$WORK/server.js" <<'EOF'
// Fake api-gateway: answers every route with the { success, timestamp, data } envelope.
const https = require('https');
const fs = require('fs');
const [key, cert, port] = [process.argv[2], process.argv[3], Number(process.argv[4])];
let count = 0;
const data = (path) => {
  if (path.startsWith('/api/v1/restaurants') && !/\/restaurants\/[^?]/.test(path))
    return { items: [{ id: 'r1', name: 'Fake Kitchen', city: 'Hyderabad', cuisines: ['Fake'] }], total: 1, page: 1, limit: 100, totalPages: 1 };
  if (path.startsWith('/api/v1/cuisines')) return [{ id: 'c1', name: 'Fake' }];
  if (path.startsWith('/api/v1/menu/')) return [];
  return { status: 'ok' };
};
https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, (req, res) => {
  if (req.url === '/__count') { res.end(String(count)); return; }
  count++;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ success: true, timestamp: new Date().toISOString(), data: data(req.url) }));
}).listen(port, '0.0.0.0');
EOF
node "$(win "$WORK/server.js")" "$(win "$WORK/key.pem")" "$(win "$WORK/cert.pem")" "$PORT" &
SERVER_PID=$!
for _ in $(seq 1 20); do curl -sk "https://127.0.0.1:${PORT}/__count" >/dev/null 2>&1 && break; sleep 0.5; done
count() { curl -sk "https://127.0.0.1:${PORT}/__count"; }
# Hard precondition: every "0 requests" assertion below is meaningless without a live counter.
[[ "$(count)" =~ ^[0-9]+$ ]] || { echo "FAIL  fake API did not start on port ${PORT}"; exit 1; }

stamp_aged() { # seconds-old
  printf '{"ok":true,"baseUrl":"%s","checkedAtEpochMs":%s}\n' "$BASE_URL" "$(( ($(date +%s) - $1) * 1000 ))" \
    > "$WORK/suite/results/preflight.json"
}
k6run() { # extra -e args...
  docker run --rm -v "$(win "$WORK/suite"):/t" -w /t --add-host "api.patheyaexpress.com:host-gateway" \
    -e PROFILE=smoke -e BASE_URL="$BASE_URL" "$@" "$IMAGE" run --quiet --insecure-skip-tls-verify main.js 2>&1
}

failures=0
check() { # name condition-result detail
  if [[ "$2" == "0" ]]; then printf '  PASS  %s\n' "$1"; else printf '  FAIL  %s — %s\n' "$1" "$3"; failures=$((failures + 1)); fi
}

echo "preflight gate lifecycle regression (fake API at ${BASE_URL})"

# 3. Missing CONFIRM_PRODUCTION -> rejected at init, no request.
stamp_aged 0; before=$(count); out=$(k6run); code=$?
grep -q "requires CONFIRM_PRODUCTION=I_UNDERSTAND" <<<"$out" && [[ $code -ne 0 && "$(count)" == "$before" ]]
check "no CONFIRM_PRODUCTION -> rejected, 0 requests" $? "exit=$code requests=$(( $(count) - before ))"

# 2a. Missing stamp -> rejected in setup() before any request (incl. readiness).
rm -f "$WORK/suite/results/preflight.json"; before=$(count); out=$(k6run -e CONFIRM_PRODUCTION=I_UNDERSTAND); code=$?
grep -q "No results/preflight.json" <<<"$out" && [[ $code -ne 0 && "$(count)" == "$before" ]]
check "missing stamp -> rejected, 0 requests" $? "exit=$code requests=$(( $(count) - before ))"

# 2b. Expired stamp -> rejected before any request.
stamp_aged 1000; before=$(count); out=$(k6run -e CONFIRM_PRODUCTION=I_UNDERSTAND); code=$?
grep -q "Preflight stamp is not valid" <<<"$out" && [[ $code -ne 0 && "$(count)" == "$before" ]]
check "expired stamp (1000 s) -> rejected, 0 requests" $? "exit=$code requests=$(( $(count) - before ))"

# 1. Valid at setup (880 s old), expired by the end (~1020 s) -> test runs AND the summary is kept.
stamp_aged 880; rm -f "$WORK/suite/results/smoke-"*; before=$(count)
out=$(k6run -e CONFIRM_PRODUCTION=I_UNDERSTAND); code=$?
sent=$(( $(count) - before ))
summary=$(ls "$WORK/suite/results/" | grep -c '^smoke-.*\.json$')
[[ $code -eq 0 && $sent -gt 50 && $summary -eq 1 ]] && ! grep -q "failed to handle the end-of-test summary" <<<"$out"
check "stamp valid at setup, expired by summary -> run completes, summary written" $? \
  "exit=$code requests=$sent summaries=$summary $(grep -o 'failed to handle[^"]*' <<<"$out" | head -1)"

if (( failures > 0 )); then echo "FAILED: ${failures} case(s)"; exit 1; fi
echo "all cases passed"
