#!/bin/zsh
# mm_fuzz_swarm.sh — launch N detached fuzz workers per stage on Azure Playwright Workspaces (or locally).
#   source /tmp/pw_token.env   (PLAYWRIGHT_SERVICE_URL + PLAYWRIGHT_SERVICE_ACCESS_TOKEN)
#   tools/mm_fuzz_swarm.sh "1 2 3 4 6" 8 40 8      # stages, workers/stage, episodes, seconds
set -u
STAGES=${1:-"1 2 3 4 6"}; PER=${2:-8}; EPISODES=${3:-40}; SECONDS_EP=${4:-8}
LOGS=${LOGS:-/tmp/fuzzlogs}; mkdir -p "$LOGS"
export RUN_ID="mmfuzz-$(date +%H%M%S)"
for st in ${=STAGES}; do
  for w in $(seq 1 $PER); do
    nohup node tools/mm_fuzz.mjs $st --episodes $EPISODES --seconds $SECONDS_EP --seed $((st * 1000 + w * 17 + RANDOM % 1000)) --worker "s${st}w${w}_$RUN_ID" > "$LOGS/s${st}w${w}.log" 2>&1 < /dev/null &
    sleep 0.3
  done
done
echo "launched $(pgrep -f mm_fuzz.mjs | wc -l | tr -d ' ') workers (run $RUN_ID); logs in $LOGS"
wait
echo "swarm $RUN_ID finished"
