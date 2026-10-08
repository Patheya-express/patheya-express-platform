#!/usr/bin/env bash
# Read-only: shows which RATE_LIMIT_MAX the RUNNING production API revision has, so it is always
# obvious whether the temporary load-test override is active (README "Rate-limit lifecycle").
#
#   ./scripts/rate-limit-status.sh                         # print only
#   ./scripts/rate-limit-status.sh --expect=default        # exit 1 unless 100 (normal production)
#   ./scripts/rate-limit-status.sh --expect-at-least=60000 # exit 1 unless the override is active
set -euo pipefail

: "${AWS_PROFILE:?set AWS_PROFILE to the production account profile (read-only is enough)}"
export AWS_REGION="${AWS_REGION:-ap-south-1}"
PREFIX="${NAME_PREFIX:-patheya-production}"
DEFAULT_LIMIT=100

# `tr -d '\r'`: the Windows AWS CLI ends text-output lines with \r\n (see preflight.sh q()).
read -r td_arn rollout < <(aws ecs describe-services --cluster "${PREFIX}-ecs" --services "${PREFIX}-api" \
  --query 'services[0].deployments[?status==`PRIMARY`] | [0].[taskDefinition,rolloutState]' --output text | tr -d '\r')
raw=$(aws ecs describe-task-definition --task-definition "$td_arn" \
  --query 'taskDefinition.containerDefinitions[?name==`api`] | [0].environment[?name==`RATE_LIMIT_MAX`] | [0].value' \
  --output text | tr -d '\r')

if [[ "$raw" == "None" || -z "$raw" ]]; then
  active=$DEFAULT_LIMIT; source_desc="unset -> default"
else
  active=$raw; source_desc="RATE_LIMIT_MAX=${raw}"
fi
mode=$([[ "$active" == "$DEFAULT_LIMIT" ]] && echo "NORMAL" || echo "LOAD-TEST OVERRIDE")
echo "API rate limit: ${active} req/60s per IP — ${mode} (${source_desc}; ${td_arn##*/}, rollout ${rollout})"

case "${1:-}" in
  --expect=default)
    [[ "$active" == "$DEFAULT_LIMIT" && "$rollout" == "COMPLETED" ]] \
      || { echo "EXPECTED the normal limit (${DEFAULT_LIMIT}) fully rolled out."; exit 1; } ;;
  --expect-at-least=*)
    want=${1#*=}
    [[ "$active" =~ ^[0-9]+$ && "$active" -ge "$want" && "$rollout" == "COMPLETED" ]] \
      || { echo "EXPECTED a load-test limit >= ${want}, fully rolled out."; exit 1; } ;;
  "") ;;
  *) echo "unknown option: $1"; exit 2 ;;
esac
