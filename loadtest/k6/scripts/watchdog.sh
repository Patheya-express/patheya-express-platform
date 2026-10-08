#!/usr/bin/env bash
# Server-side abort guard. Polls CloudWatch (read-only) + readiness every POLL_SECONDS and stops
# the running k6 test through k6's local REST API when a critical condition is SUSTAINED.
# Client-side conditions (error rate, p95, p99, 429s) are enforced by k6 thresholds in main.js.
#
# Start k6 with `--address 127.0.0.1:6565`, then in a second terminal:
#   AWS_PROFILE=<prod read-only> BASE_URL=https://api.patheyaexpress.com ./scripts/watchdog.sh
#
# Requires GNU date (Linux or Git Bash). Every poll is appended to results/watchdog-*.log, which
# doubles as the server-side time series for the capacity report.
set -uo pipefail

: "${AWS_PROFILE:?set AWS_PROFILE to the production account profile (read-only is enough)}"
: "${BASE_URL:?set BASE_URL, e.g. https://api.patheyaexpress.com}"
export AWS_REGION="${AWS_REGION:-ap-south-1}"
PREFIX="${NAME_PREFIX:-patheya-production}"
K6_API="${K6_API:-http://127.0.0.1:6565}"
POLL_SECONDS="${POLL_SECONDS:-60}"
SUSTAIN_MINUTES="${SUSTAIN_MINUTES:-3}"   # consecutive 1-minute datapoints that must breach

# Abort thresholds (README "Safety limits"). DB connection limit: Aurora max_connections for the
# writer class x RDS Proxy max_connections_percent (80). Verify with `SHOW max_connections;`.
ECS_API_CPU_MAX="${ECS_API_CPU_MAX:-85}"
ECS_API_MEM_MAX="${ECS_API_MEM_MAX:-85}"
DB_CPU_MAX="${DB_CPU_MAX:-80}"
DB_MAX_CONNECTIONS="${DB_MAX_CONNECTIONS:-1800}"
DB_CONN_MAX=$(( DB_MAX_CONNECTIONS * 80 / 100 * 80 / 100 ))   # 80% of the proxy's 80% share
REDIS_CPU_MAX="${REDIS_CPU_MAX:-80}"
REDIS_MEM_MAX="${REDIS_MEM_MAX:-75}"
# Optional: Prometheus endpoint exposing patheya_bullmq_jobs_waiting (api-gateway /metrics).
# In production /metrics is internal-only: it needs METRICS_TOKEN (= the deployed
# METRICS_AUTH_TOKEN), otherwise it returns 404 and the queue check is skipped (logged as n/a).
METRICS_URL="${METRICS_URL:-}"
QUEUE_GROWTH_POLLS="${QUEUE_GROWTH_POLLS:-5}"
QUEUE_MIN_DEPTH="${QUEUE_MIN_DEPTH:-100}"

cd "$(dirname "$0")/.."
mkdir -p results
LOG="results/watchdog-$(date -u +%Y%m%dT%H%M%SZ).log"

stop_k6() {
  echo "$(date -u +%FT%TZ) ABORT: $1" | tee -a "$LOG"
  curl -s -X PATCH "${K6_API}/v1/status" -H 'Content-Type: application/json' \
    -d '{"data":{"type":"status","id":"default","attributes":{"stopped":true}}}' >/dev/null \
    && echo "k6 stop requested via ${K6_API}" | tee -a "$LOG" \
    || echo "!! could not reach k6 at ${K6_API} — STOP IT MANUALLY (Ctrl+C)" | tee -a "$LOG"
  exit 2
}

# Last N one-minute datapoints of a metric, oldest first, space-separated.
series() { # namespace metric stat dimensions...
  local ns=$1 metric=$2 stat=$3; shift 3
  aws cloudwatch get-metric-statistics --namespace "$ns" --metric-name "$metric" \
    --dimensions "$@" --statistics "$stat" --period 60 \
    --start-time "$(date -u -d "-$((SUSTAIN_MINUTES + 3)) min" +%FT%TZ)" --end-time "$(date -u +%FT%TZ)" \
    --query "sort_by(Datapoints,&Timestamp)[-${SUSTAIN_MINUTES}:].${stat}" --output text 2>/dev/null \
    | tr -d '\r' # Windows AWS CLI ends text-output lines with \r\n
}

# True when there are SUSTAIN_MINUTES datapoints and every one is above the limit.
sustained_above() { # "values" limit
  awk -v limit="$2" -v need="$SUSTAIN_MINUTES" '{ for (i = 1; i <= NF; i++) { n++; if ($i + 0 <= limit) ok = 1 } }
    END { exit !(n >= need && !ok) }' <<<"$1"
}

lb_arn=$(aws elbv2 describe-load-balancers --names "${PREFIX}-alb" --query 'LoadBalancers[0].LoadBalancerArn' --output text | tr -d '\r')
tg_arn=$(aws elbv2 describe-target-groups --names "${PREFIX}-api-tg" --query 'TargetGroups[0].TargetGroupArn' --output text | tr -d '\r')
LB_DIM="Name=LoadBalancer,Value=${lb_arn#*:loadbalancer/}"
TG_DIM="Name=TargetGroup,Value=${tg_arn##*:}"
ECS_API=("Name=ClusterName,Value=${PREFIX}-ecs" "Name=ServiceName,Value=${PREFIX}-api")
ECS_WORKER=("Name=ClusterName,Value=${PREFIX}-ecs" "Name=ServiceName,Value=${PREFIX}-worker")
DB_DIM="Name=DBInstanceIdentifier,Value=${PREFIX}-aurora-writer"
REDIS_DIM="Name=CacheClusterId,Value=${PREFIX}-redis-001"

echo "watchdog: polling every ${POLL_SECONDS}s, sustain=${SUSTAIN_MINUTES}m, db_conn_max=${DB_CONN_MAX}, log=${LOG}"
not_ready=0
k6_missing=0
queue_prev=-1
queue_growth=0

while true; do
  if curl -s -o /dev/null --max-time 5 "${K6_API}/v1/status"; then k6_missing=0; else
    k6_missing=$((k6_missing + 1))
    (( k6_missing >= 3 )) && { echo "k6 not reachable for 3 polls — test finished; exiting." | tee -a "$LOG"; exit 0; }
  fi

  api_cpu=$(series AWS/ECS CPUUtilization Average "${ECS_API[@]}")
  api_mem=$(series AWS/ECS MemoryUtilization Average "${ECS_API[@]}")
  wrk_cpu=$(series AWS/ECS CPUUtilization Average "${ECS_WORKER[@]}")
  db_cpu=$(series AWS/RDS CPUUtilization Average "$DB_DIM")
  db_conn=$(series AWS/RDS DatabaseConnections Maximum "$DB_DIM")
  redis_cpu=$(series AWS/ElastiCache EngineCPUUtilization Average "$REDIS_DIM")
  redis_mem=$(series AWS/ElastiCache DatabaseMemoryUsagePercentage Maximum "$REDIS_DIM")
  healthy=$(series AWS/ApplicationELB HealthyHostCount Minimum "$TG_DIM" "$LB_DIM")
  unhealthy=$(series AWS/ApplicationELB UnHealthyHostCount Maximum "$TG_DIM" "$LB_DIM")
  ready=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "${BASE_URL%/}/api/v1/health/ready" || echo 000)

  queue="n/a"
  if [[ -n "$METRICS_URL" ]]; then
    auth=()
    [[ -n "${METRICS_TOKEN:-}" ]] && auth=(-H "Authorization: Bearer ${METRICS_TOKEN}")
    queue=$(curl -sf --max-time 10 "${auth[@]}" "$METRICS_URL" | awk '/^patheya_bullmq_jobs_waiting/ { s += $NF } END { print s + 0 }') \
      || queue="n/a"
  fi

  printf '%s api_cpu=[%s] api_mem=[%s] worker_cpu=[%s] db_cpu=[%s] db_conn=[%s] redis_cpu=[%s] redis_mem=[%s] healthy=[%s] unhealthy=[%s] ready=%s queue_waiting=%s\n' \
    "$(date -u +%FT%TZ)" "$api_cpu" "$api_mem" "$wrk_cpu" "$db_cpu" "$db_conn" "$redis_cpu" "$redis_mem" "$healthy" "$unhealthy" "$ready" "$queue" | tee -a "$LOG"

  sustained_above "$api_cpu" "$ECS_API_CPU_MAX" && stop_k6 "ECS API CPU > ${ECS_API_CPU_MAX}% for ${SUSTAIN_MINUTES}m"
  sustained_above "$api_mem" "$ECS_API_MEM_MAX" && stop_k6 "ECS API memory > ${ECS_API_MEM_MAX}% for ${SUSTAIN_MINUTES}m"
  sustained_above "$db_cpu" "$DB_CPU_MAX" && stop_k6 "Aurora writer CPU > ${DB_CPU_MAX}% for ${SUSTAIN_MINUTES}m"
  sustained_above "$db_conn" "$DB_CONN_MAX" && stop_k6 "Aurora connections > ${DB_CONN_MAX} for ${SUSTAIN_MINUTES}m"
  sustained_above "$redis_cpu" "$REDIS_CPU_MAX" && stop_k6 "Redis engine CPU > ${REDIS_CPU_MAX}% for ${SUSTAIN_MINUTES}m"
  sustained_above "$redis_mem" "$REDIS_MEM_MAX" && stop_k6 "Redis memory > ${REDIS_MEM_MAX}% for ${SUSTAIN_MINUTES}m"

  # Target health is critical immediately — no sustain window. Latest datapoint = last
  # whitespace-separated field (the AWS CLI separates datapoints with tabs, not spaces).
  last_healthy=$(awk '{print $NF}' <<<"$healthy")
  [[ -n "$last_healthy" && "$last_healthy" != "None" ]] && awk -v h="$last_healthy" 'BEGIN { exit !(h < 1) }' \
    && stop_k6 "ALB HealthyHostCount dropped to ${last_healthy}"
  last_unhealthy=$(awk '{print $NF}' <<<"$unhealthy")
  [[ -n "$last_unhealthy" && "$last_unhealthy" != "None" ]] && awk -v u="$last_unhealthy" 'BEGIN { exit !(u > 0) }' \
    && stop_k6 "ALB UnHealthyHostCount = ${last_unhealthy}"

  if [[ "$ready" == "200" ]]; then not_ready=0; else
    not_ready=$((not_ready + 1))
    (( not_ready >= 2 )) && stop_k6 "readiness returned ${ready} on 2 consecutive polls"
  fi

  if [[ "$queue" =~ ^[0-9]+$ ]]; then
    if (( queue_prev >= 0 && queue > queue_prev )); then queue_growth=$((queue_growth + 1)); else queue_growth=0; fi
    queue_prev=$queue
    (( queue_growth >= QUEUE_GROWTH_POLLS && queue >= QUEUE_MIN_DEPTH )) \
      && stop_k6 "BullMQ waiting jobs grew for ${QUEUE_GROWTH_POLLS} consecutive polls (now ${queue})"
  fi

  sleep "$POLL_SECONDS"
done
