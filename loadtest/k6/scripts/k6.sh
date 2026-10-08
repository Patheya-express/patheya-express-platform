#!/usr/bin/env bash
# Runs the suite with Docker's grafana/k6 image — no global k6 install.
#
#   PROFILE=smoke BASE_URL=https://api.patheyaexpress.com CONFIRM_PRODUCTION=I_UNDERSTAND ./scripts/k6.sh
#
# Configuration is passed as environment variables BY NAME (`-e NAME`), so values — including
# LT_EMAIL/LT_PASSWORD — never appear on a command line or in shell history from this script.
# k6's REST API is published on 127.0.0.1:6565 so scripts/watchdog.sh can stop the run.
# Extra arguments are passed to `k6 run` (e.g. --quiet). All safety limits live in lib/config.js.
set -euo pipefail

IMAGE="${K6_IMAGE:-grafana/k6:2.3.0}"
cd "$(dirname "$0")/.."
mkdir -p results

export MSYS_NO_PATHCONV=1 # Git Bash: keep /loadtest as a container path
mount_src="$(pwd -W 2>/dev/null || pwd)"
user_args=()
case "$(uname -s)" in
  Linux*) user_args=(--user "$(id -u):$(id -g)") ;; # results/ stays owned by the operator
esac

exec docker run --rm -i --name patheya-k6 \
  "${user_args[@]}" \
  -p 127.0.0.1:6565:6565 \
  -v "${mount_src}:/loadtest" -w /loadtest \
  -e BASE_URL -e PROFILE -e CONFIRM_PRODUCTION \
  -e LT_EMAIL -e LT_PASSWORD \
  -e MAX_VUS -e MAX_RPS -e STRESS_VUS -e SPIKE_VUS -e SOAK_VUS -e ALLOW_EMPTY_CATALOG \
  "$IMAGE" run --address 0.0.0.0:6565 "$@" main.js
