#!/usr/bin/env bash
# Read-only go/no-go gate for a production load test. Writes results/preflight.json ONLY when
# every check passes; main.js refuses to target production without a stamp < 15 minutes old.
#
# Uses only describe/get AWS calls plus a single GET /api/v1/health/ready. Changes nothing.
#
#   AWS_PROFILE=<production read-only profile> BASE_URL=https://api.patheyaexpress.com \
#     ./scripts/preflight.sh
set -euo pipefail

: "${AWS_PROFILE:?set AWS_PROFILE to the production account profile (read-only is enough)}"
: "${BASE_URL:?set BASE_URL, e.g. https://api.patheyaexpress.com}"
export AWS_REGION="${AWS_REGION:-ap-south-1}"
PREFIX="${NAME_PREFIX:-patheya-production}"
EXPECTED_WRITER_CLASS="${EXPECTED_WRITER_CLASS:-db.r6g.large}"

cd "$(dirname "$0")/.."
mkdir -p results
rm -f results/preflight.json

failures=0
pass() { printf '  PASS  %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; failures=$((failures + 1)); }
q() { aws "$@" --output text 2>/dev/null || echo "ERROR"; }

echo "Preflight: ${PREFIX} in ${AWS_REGION} -> ${BASE_URL}"

# Aurora: cluster + writer available, no pending modification (i.e. the resize has finished).
cluster_status=$(q rds describe-db-clusters --db-cluster-identifier "${PREFIX}-aurora" --query 'DBClusters[0].Status')
[[ "$cluster_status" == "available" ]] && pass "Aurora cluster available" || fail "Aurora cluster status: $cluster_status"

read -r writer_status writer_class pending_class < <(q rds describe-db-instances \
  --db-instance-identifier "${PREFIX}-aurora-writer" \
  --query 'DBInstances[0].[DBInstanceStatus,DBInstanceClass,PendingModifiedValues.DBInstanceClass]')
[[ "$writer_status" == "available" ]] && pass "Aurora writer available ($writer_class)" || fail "Aurora writer status: $writer_status"
[[ "$pending_class" == "None" ]] && pass "Aurora writer has no pending class change" || fail "Aurora writer pending class change: $pending_class"
[[ "$writer_class" == "$EXPECTED_WRITER_CLASS" ]] && pass "Aurora writer class is $EXPECTED_WRITER_CLASS" \
  || fail "Aurora writer class $writer_class != expected $EXPECTED_WRITER_CLASS (set EXPECTED_WRITER_CLASS to override)"

# RDS Proxy: proxy available and its writer target AVAILABLE.
proxy_status=$(q rds describe-db-proxies --db-proxy-name "${PREFIX}-aurora-proxy" --query 'DBProxies[0].Status')
[[ "$proxy_status" == "available" ]] && pass "RDS Proxy available" || fail "RDS Proxy status: $proxy_status"
proxy_targets=$(q rds describe-db-proxy-targets --db-proxy-name "${PREFIX}-aurora-proxy" \
  --query 'Targets[?Type==`RDS_INSTANCE`].TargetHealth.State')
if [[ -n "$proxy_targets" && "$proxy_targets" != "ERROR" ]] && ! grep -qvE '^(AVAILABLE[[:space:]]*)+$' <<<"$proxy_targets"; then
  pass "RDS Proxy targets AVAILABLE"
else
  fail "RDS Proxy target health: ${proxy_targets:-none}"
fi

# Redis replication group available.
redis_status=$(q elasticache describe-replication-groups --replication-group-id "${PREFIX}-redis" --query 'ReplicationGroups[0].Status')
[[ "$redis_status" == "available" ]] && pass "Redis available" || fail "Redis status: $redis_status"

# ECS: API and worker steady (running == desired >= 1, single COMPLETED deployment).
for svc in api worker; do
  read -r desired running deployments rollout < <(q ecs describe-services --cluster "${PREFIX}-ecs" \
    --services "${PREFIX}-${svc}" \
    --query 'services[0].[desiredCount,runningCount,length(deployments),deployments[0].rolloutState]')
  if [[ "$desired" =~ ^[0-9]+$ && "$desired" -ge 1 && "$running" == "$desired" && "$deployments" == "1" && "$rollout" == "COMPLETED" ]]; then
    pass "ECS ${svc}: ${running}/${desired} running, rollout COMPLETED"
  else
    fail "ECS ${svc}: desired=${desired} running=${running} deployments=${deployments} rollout=${rollout}"
  fi
done

# ALB: every registered API target healthy.
tg_arn=$(q elbv2 describe-target-groups --names "${PREFIX}-api-tg" --query 'TargetGroups[0].TargetGroupArn')
tg_states=$(q elbv2 describe-target-health --target-group-arn "$tg_arn" --query 'TargetHealthDescriptions[].TargetHealth.State')
if [[ -n "$tg_states" && "$tg_states" != "ERROR" ]] && ! grep -qvE '^(healthy[[:space:]]*)+$' <<<"$tg_states"; then
  pass "ALB targets healthy ($(wc -w <<<"$tg_states"))"
else
  fail "ALB target health: ${tg_states:-none}"
fi

# Rate limit: the temporary load-test override must be live, or the run measures HTTP 429s.
if ./scripts/rate-limit-status.sh --expect-at-least="${REQUIRED_RATE_LIMIT_MAX:-60000}"; then
  pass "Load-test rate-limit override active"
else
  fail "Load-test rate-limit override not active (see README \"Rate-limit lifecycle\")"
fi

# Application readiness (DB + Redis + BullMQ) — one request.
ready_code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "${BASE_URL%/}/api/v1/health/ready" || echo "000")
[[ "$ready_code" == "200" ]] && pass "GET /api/v1/health/ready = 200" || fail "GET /api/v1/health/ready = $ready_code"

if (( failures > 0 )); then
  echo "Preflight FAILED (${failures} check(s)). No stamp written — do not run the load test."
  exit 1
fi

printf '{"ok":true,"baseUrl":"%s","writerClass":"%s","checkedAtEpochMs":%s}\n' \
  "${BASE_URL%/}" "$writer_class" "$(($(date +%s) * 1000))" > results/preflight.json
echo "Preflight PASSED — stamp written to results/preflight.json (valid 15 minutes)."
