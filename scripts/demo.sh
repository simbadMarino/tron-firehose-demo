#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -f "${ROOT_DIR}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${ROOT_DIR}/.env"
  set +a
fi

FIREHOSE_ENDPOINT="${FIREHOSE_ENDPOINT:-127.0.0.1:8089}"
STREAM_MAX_BLOCKS="${STREAM_MAX_BLOCKS:-5}"
STREAM_START_BLOCK="${STREAM_START_BLOCK:--20}"
LOG_FILE="${ROOT_DIR}/.data/firecore.log"

mkdir -p "${ROOT_DIR}/.data"

"${ROOT_DIR}/scripts/start-firehose.sh" >"${LOG_FILE}" 2>&1 &
firecore_pid=$!

cleanup() {
  kill "${firecore_pid}" >/dev/null 2>&1 || true
}

trap cleanup EXIT

host="${FIREHOSE_ENDPOINT%:*}"
port="${FIREHOSE_ENDPOINT##*:}"
ready=0

for _ in $(seq 1 60); do
  if (echo >/dev/tcp/"${host}"/"${port}") >/dev/null 2>&1; then
    ready=1
    break
  fi

  if ! kill -0 "${firecore_pid}" >/dev/null 2>&1; then
    echo "firecore exited early; inspect ${LOG_FILE}" >&2
    exit 1
  fi

  sleep 1
done

if [[ "${ready}" -ne 1 ]]; then
  echo "firehose endpoint ${FIREHOSE_ENDPOINT} did not become ready; inspect ${LOG_FILE}" >&2
  exit 1
fi

npm run --prefix "${ROOT_DIR}" stream -- \
  --endpoint="${FIREHOSE_ENDPOINT}" \
  --start-block="${STREAM_START_BLOCK}" \
  --max-blocks="${STREAM_MAX_BLOCKS}"
