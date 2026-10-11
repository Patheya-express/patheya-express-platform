#!/usr/bin/env bash
# Regression test for watchdog.sh's 5xx, Aurora latency, queue backlog and capacity-ceiling guards.
# Same approach as watchdog-alb.test.sh: the REAL watchdog.sh against stub `aws` and `curl`
# (no AWS or network access); healthy runs end after 3 polls once k6 is unreachable (exit 0),
# aborts exit 2.
#
#   bash loadtest/k6/tests/watchdog-guards.test.sh
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/bin" "$WORK/k6/scripts"
cp "$ROOT/scripts/watchdog.sh" "$WORK/k6/scripts/"

cat > "$WORK/bin/aws" <<'STUB'
#!/usr/bin/env bash
emit() { printf '%b\r\n' "$1"; }
case "$*" in
  *describe-load-balancers*) emit 'arn:aws:elasticloadbalancing:ap-south-1:1:loadbalancer/app/patheya-production-alb/x' ;;
  *describe-target-groups*)  emit 'arn:aws:elasticloadbalancing:ap-south-1:1:targetgroup/patheya-production-api-tg/y' ;;
  *describe-services*)        emit "${STUB_DESIRED:-2\t1}" ;;
  *HealthyHostCount*Minimum*) emit '2.0\t2.0\t2.0' ;;
  *UnHealthyHostCount*)       emit '0.0\t0.0\t0.0' ;;
  *HTTPCode_ELB_5XX_Count*)   emit "${STUB_ELB5XX:-None}" ;;
  *HTTPCode_Target_5XX_Count*) emit "${STUB_TGT5XX:-None}" ;;
  *ReadLatency*)              emit "${STUB_RLAT:-0.002\t0.002\t0.002}" ;;
  *WriteLatency*)             emit "${STUB_WLAT:-0.003\t0.003\t0.003}" ;;
  *BacklogWaiting*)           emit "${STUB_BACKLOG:-0.0\t0.0\t0.0}" ;;
  *get-metric-statistics*)    emit '1.0\t2.0\t3.0' ;;
  *) echo "unstubbed aws call: $*" >&2; exit 99 ;;
esac
STUB
cat > "$WORK/bin/curl" <<'STUB'
#!/usr/bin/env bash
case "$*" in
  *health/ready*) printf '200' ;;
  *) exit 7 ;;
esac
STUB
chmod +x "$WORK/bin/aws" "$WORK/bin/curl"

failures=0
run_case() { # name expected_exit expected_text VAR=value...
  local name=$1 want=$2 text=$3 out code; shift 3
  out=$(cd "$WORK/k6" && env PATH="$WORK/bin:$PATH" AWS_PROFILE=stub BASE_URL=https://example.invalid \
    POLL_SECONDS=0 "$@" timeout 60 ./scripts/watchdog.sh 2>&1)
  code=$?
  if [[ "$code" == "$want" ]] && grep -q -- "$text" <<<"$out"; then
    printf '  PASS  %s\n' "$name"
  else
    printf '  FAIL  %s (exit %s, expected %s with "%s")\n%s\n' "$name" "$code" "$want" "$text" "$out"
    failures=$((failures + 1))
  fi
}

echo "watchdog.sh 5xx / latency / backlog / capacity guards"
run_case "all healthy, no 5xx datapoints -> no abort" 0 "test finished"
run_case "target 5xx sustained over limit -> abort" 2 "ABORT: Target 5xx > 10/min" 'STUB_TGT5XX=12\t15\t30'
run_case "ALB 5xx sustained over limit -> abort" 2 "ABORT: ALB 5xx > 10/min" 'STUB_ELB5XX=11\t11\t11'
run_case "one 5xx burst only -> no abort" 0 "test finished" 'STUB_TGT5XX=2\t40\t3'
run_case "Aurora read latency sustained -> abort" 2 "ABORT: Aurora read latency" 'STUB_RLAT=0.09\t0.08\t0.12'
run_case "Aurora write latency sustained -> abort" 2 "ABORT: Aurora write latency" 'STUB_WLAT=0.2\t0.2\t0.2'
run_case "queue backlog sustained -> abort" 2 "ABORT: Queue backlog > 200" 'STUB_BACKLOG=250\t400\t900'
run_case "queue metric absent -> no abort" 0 "test finished" 'STUB_BACKLOG=None'
# Capacity counts consecutive polls; the stub k6 is unreachable, so the watchdog exits on poll 3.
# SUSTAIN_MINUTES=2 lets the ceiling trip first (the metric checks look at 2 datapoints then).
run_case "API at maximum for 2 polls -> abort" 2 "ABORT: API held at its maximum of 6" 'STUB_DESIRED=6\t1' SUSTAIN_MINUTES=2
run_case "worker at maximum for 2 polls -> abort" 2 "ABORT: Worker held at its maximum of 3" 'STUB_DESIRED=2\t3' SUSTAIN_MINUTES=2
run_case "API below maximum -> no abort" 0 "test finished" 'STUB_DESIRED=5\t2'

if (( failures > 0 )); then echo "FAILED: ${failures} case(s)"; exit 1; fi
echo "all cases passed"
