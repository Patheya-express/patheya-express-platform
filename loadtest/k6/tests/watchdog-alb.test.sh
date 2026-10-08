#!/usr/bin/env bash
# Regression test for watchdog.sh's immediate ALB target-health checks.
#
# Runs the REAL watchdog.sh against stub `aws` and `curl` executables (no AWS or network access).
# The stub AWS CLI returns CloudWatch series exactly as the real one does — datapoints separated by
# TABS, lines ending in \r\n on Windows — and everything else well below every threshold.
#
#   bash loadtest/k6/tests/watchdog-alb.test.sh
#
# Watchdog exits 0 once k6 is unreachable for 3 polls (no abort) and 2 when it aborts; the stub
# curl reports k6 as unreachable, so a healthy run ends after 3 quick polls.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/bin" "$WORK/k6/scripts"
cp "$ROOT/scripts/watchdog.sh" "$WORK/k6/scripts/" # results/ log lands in $WORK, not the repo

cat > "$WORK/bin/aws" <<'EOF'
#!/usr/bin/env bash
emit() { printf '%b\r\n' "$1"; } # %b expands \t in the STUB_* values
case "$*" in
  *describe-load-balancers*) emit 'arn:aws:elasticloadbalancing:ap-south-1:1:loadbalancer/app/patheya-production-alb/x' ;;
  *describe-target-groups*)  emit 'arn:aws:elasticloadbalancing:ap-south-1:1:targetgroup/patheya-production-api-tg/y' ;;
  *HealthyHostCount*Minimum*) emit "$STUB_HEALTHY" ;;   # HealthyHostCount
  *UnHealthyHostCount*)       emit "$STUB_UNHEALTHY" ;; # matched before the generic case below
  *get-metric-statistics*)    emit '1.0\t2.0\t3.0' ;;   # CPU/memory/DB/Redis: far below limits
  *) echo "unstubbed aws call: $*" >&2; exit 99 ;;
esac
EOF
cat > "$WORK/bin/curl" <<'EOF'
#!/usr/bin/env bash
case "$*" in
  *health/ready*) printf '200' ;;
  *) exit 7 ;; # k6 REST API unreachable (status poll and stop request)
esac
EOF
chmod +x "$WORK/bin/aws" "$WORK/bin/curl"

failures=0
run_case() { # name healthy unhealthy expected_exit expected_text
  local name=$1 out code
  out=$(cd "$WORK/k6" && PATH="$WORK/bin:$PATH" AWS_PROFILE=stub BASE_URL=https://example.invalid \
    POLL_SECONDS=0 STUB_HEALTHY="$2" STUB_UNHEALTHY="$3" timeout 60 ./scripts/watchdog.sh 2>&1)
  code=$?
  if [[ "$code" == "$4" ]] && grep -q -- "$5" <<<"$out"; then
    printf '  PASS  %s\n' "$name"
  else
    printf '  FAIL  %s (exit %s, expected %s with "%s")\n%s\n' "$name" "$code" "$4" "$5" "$out"
    failures=$((failures + 1))
  fi
}

echo "watchdog.sh ALB target-health regression"
run_case "tab-separated, all healthy -> no abort"      '1.0\t1.0\t1.0' '0.0\t0.0\t0.0' 0 "test finished"
run_case "tab-separated, latest unhealthy=1 -> abort"  '1.0\t1.0\t1.0' '0.0\t0.0\t1.0' 2 "ABORT: ALB UnHealthyHostCount = 1.0"
run_case "space-separated, all healthy -> no abort"    '1.0 1.0 1.0'   '0.0 0.0 0.0'   0 "test finished"
run_case "space-separated, latest unhealthy=1 -> abort" '1.0 1.0 1.0'  '0.0 0.0 1.0'   2 "ABORT: ALB UnHealthyHostCount = 1.0"
run_case "tab-separated, latest healthy=0 -> abort"    '1.0\t1.0\t0.0' '0.0\t0.0\t0.0' 2 "ABORT: ALB HealthyHostCount dropped to 0.0"
run_case "earlier unhealthy datapoint only -> no abort (latest decides)" '1.0\t1.0\t1.0' '1.0\t0.0\t0.0' 0 "test finished"
run_case "no datapoints (None) -> no abort"            'None'          'None'          0 "test finished"

if (( failures > 0 )); then echo "FAILED: ${failures} case(s)"; exit 1; fi
echo "all cases passed"
