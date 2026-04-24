#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -f "${ROOT_DIR}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${ROOT_DIR}/.env"
  set +a
fi

GO_BIN="${GO_BIN:-go}"

: "${TRON_RPC_ENDPOINT:?set TRON_RPC_ENDPOINT in .env or the shell environment}"
: "${TRON_API_KEY:?set TRON_API_KEY in .env or the shell environment}"

DATA_DIR="${DATA_DIR:-${ROOT_DIR}/.data}"
FIREHOSE_CONFIG="${FIREHOSE_CONFIG:-${ROOT_DIR}/config/tron-mainnet.firehose.yaml}"
FIREHOSE_GRPC_ADDR="${FIREHOSE_GRPC_ADDR:-:8089}"
READER_NODE_START_BLOCK_NUM="${READER_NODE_START_BLOCK_NUM:-1321000}"

mkdir -p "${DATA_DIR}"

prepend_path_dir() {
  local dir="$1"

  [[ -n "${dir}" ]] || return 0
  [[ -d "${dir}" ]] || return 0

  case ":${PATH:-}:" in
    *":${dir}:"*) ;;
    *) PATH="${dir}${PATH:+:${PATH}}" ;;
  esac
}

resolve_tool() {
  local tool="$1"

  if command -v "${tool}" >/dev/null 2>&1; then
    command -v "${tool}"
    return 0
  fi

  return 1
}

if [[ -n "${INSTALL_BIN_DIR:-}" ]]; then
  prepend_path_dir "${INSTALL_BIN_DIR}"
fi

if command -v "${GO_BIN}" >/dev/null 2>&1; then
  gobin="$("${GO_BIN}" env GOBIN 2>/dev/null || true)"
  if [[ -n "${gobin}" ]]; then
    prepend_path_dir "${gobin}"
  fi

  gopaths="$("${GO_BIN}" env GOPATH 2>/dev/null || true)"
  if [[ -n "${gopaths}" ]]; then
    IFS=':' read -r -a gopath_array <<<"${gopaths}"
    for gopath in "${gopath_array[@]}"; do
      prepend_path_dir "${gopath}/bin"
    done
  fi
fi

prepend_path_dir "${HOME}/go/bin"
export PATH

if ! FIRECORE_BIN="$(resolve_tool firecore)"; then
  echo "firecore was not found. Run 'make install-tools' or set INSTALL_BIN_DIR/PATH so firecore is available." >&2
  exit 127
fi

if ! resolve_tool firetron >/dev/null; then
  echo "firetron was not found. Run 'make install-tools' or set INSTALL_BIN_DIR/PATH so firetron is available." >&2
  exit 127
fi

exec "${FIRECORE_BIN}" \
  -c "${FIREHOSE_CONFIG}" \
  start \
  --data-dir="${DATA_DIR}" \
  --firehose-grpc-listen-addr="${FIREHOSE_GRPC_ADDR}" \
  --reader-node-start-block-num="${READER_NODE_START_BLOCK_NUM}"
