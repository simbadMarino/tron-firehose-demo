#!/usr/bin/env bash
set -euo pipefail

GO_BIN="${GO_BIN:-go}"
FIRECORE_VERSION="${FIRECORE_VERSION:-v1.14.1}"
FIRETRON_VERSION="${FIRETRON_VERSION:-v0.1.0}"
INSTALL_BIN_DIR="${INSTALL_BIN_DIR:-$("${GO_BIN}" env GOPATH)/bin}"

build_from_source() {
  local repo="$1"
  local version="$2"
  local package_path="$3"
  local temp_dir

  temp_dir="$(mktemp -d)"
  git clone --depth 1 --branch "${version}" "https://github.com/${repo}.git" "${temp_dir}/repo"
  (
    cd "${temp_dir}/repo"
    GOBIN="${INSTALL_BIN_DIR}" "${GO_BIN}" install "${package_path}"
  )
  rm -rf "${temp_dir}"
}

mkdir -p "${INSTALL_BIN_DIR}"

build_from_source "streamingfast/firehose-core" "${FIRECORE_VERSION}" "./cmd/firecore"
build_from_source "streamingfast/firehose-tron" "${FIRETRON_VERSION}" "./cmd/firetron"
