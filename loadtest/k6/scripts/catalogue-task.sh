#!/usr/bin/env bash
# Runs the LOADTEST_ catalogue CLI (apps/api-gateway/scripts/loadtest-catalogue/cli.ts) inside
# production as a ONE-OFF ECS task on the currently deployed API task definition — the only
# place with network access to RDS Proxy and the DATABASE_URL secret. Nothing is printed except
# the CLI's own output (host/db name, counts, the LOADTEST_MANIFEST line).
#
#   ./scripts/catalogue-task.sh status
#   ./scripts/catalogue-task.sh seed    --confirm=LOADTEST_SEED      # needs explicit approval
#   ./scripts/catalogue-task.sh cleanup --confirm=LOADTEST_CLEANUP   # needs explicit approval
#
# Requires a profile allowed to ecs:RunTask + iam:PassRole on the API task roles (not ReadOnly),
# and CONFIRM_PRODUCTION=I_UNDERSTAND. The deployed image must contain the CLI (any release that
# includes this change).
set -euo pipefail

: "${AWS_PROFILE:?set AWS_PROFILE to a production profile that may run ECS tasks}"
[[ "${CONFIRM_PRODUCTION:-}" == "I_UNDERSTAND" ]] || { echo "set CONFIRM_PRODUCTION=I_UNDERSTAND"; exit 1; }
command="${1:?usage: catalogue-task.sh <status|seed --confirm=LOADTEST_SEED|cleanup --confirm=LOADTEST_CLEANUP>}"
case "$command" in status|seed|cleanup) ;; *) echo "unknown command: $command"; exit 2 ;; esac
shift

export AWS_REGION="${AWS_REGION:-ap-south-1}"
export MSYS_NO_PATHCONV=1
PREFIX="${NAME_PREFIX:-patheya-production}"
CLUSTER="${PREFIX}-ecs"
LOG_GROUP="${LOG_GROUP:-/patheya-express/production/ecs/api}"

task_def=$(aws ecs describe-services --cluster "$CLUSTER" --services "${PREFIX}-api" \
  --query 'services[0].taskDefinition' --output text)
network=$(aws ecs describe-services --cluster "$CLUSTER" --services "${PREFIX}-api" \
  --query 'services[0].networkConfiguration' --output json)

for arg in "$@"; do
  [[ "$arg" =~ ^--confirm=LOADTEST_(SEED|CLEANUP)$ ]] || { echo "unexpected argument: $arg"; exit 2; }
done
cmd_json=$(printf ',"%s"' node dist/scripts/loadtest-catalogue/cli.js "$command" "$@")
overrides="{\"containerOverrides\":[{\"name\":\"api\",\"command\":[${cmd_json:1}]}]}"

echo "Running '${command} $*' as a one-off task on ${task_def##*/} ..."
task_arn=$(aws ecs run-task --cluster "$CLUSTER" --launch-type FARGATE --task-definition "$task_def" \
  --network-configuration "$network" --overrides "$overrides" --started-by "loadtest-catalogue-${command}" \
  --query 'tasks[0].taskArn' --output text)
task_id=${task_arn##*/}
echo "task ${task_id} started; waiting for it to stop ..."
aws ecs wait tasks-stopped --cluster "$CLUSTER" --tasks "$task_arn"

exit_code=$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$task_arn" \
  --query 'tasks[0].containers[?name==`api`] | [0].exitCode' --output text)
aws logs get-log-events --log-group-name "$LOG_GROUP" --log-stream-name "api/api/${task_id}" \
  --start-from-head --query 'events[].message' --output text | tr '\t' '\n'
echo "task ${task_id} exit code: ${exit_code}"
[[ "$exit_code" == "0" ]]
