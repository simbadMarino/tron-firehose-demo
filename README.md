# TRON Firehose Demo

Minimal demo project for:

- reading TRON mainnet blocks from a hosted TRON gRPC endpoint
- running `firetron` as the reader-node
- running `firecore` as the local Firehose pipeline
- consuming the local Firehose stream from a Node.js CLI and printing blocks to stdout

This project does **not** run a local TRON FullNode and does **not** store data in a database yet.

## Architecture

```text
Hosted TRON gRPC endpoint
          |
          v
       firetron
          |
          v
       firecore
          |
          v
local Firehose endpoint (127.0.0.1:8089)
          |
          v
   Node.js CLI consumer
```

Endpoint roles:

- `TRON_RPC_ENDPOINT`
  - remote TRON gRPC source
  - example: `http://grpc.trongrid.io:50051`
- `FIREHOSE_ENDPOINT`
  - local Firehose gRPC server started by `firecore`
  - default: `127.0.0.1:8089`

## Requirements

- Node.js 22+
- Go installed locally
- `git`
- a hosted TRON gRPC endpoint compatible with the TRON `Wallet` API
- an API key for that provider if required

## Project Files

- [config/tron-mainnet.firehose.yaml](./config/tron-mainnet.firehose.yaml)
  - local `firecore` config
- [scripts/install-tools.sh](./scripts/install-tools.sh)
  - installs `firecore` and `firetron` from source tags
- [scripts/start-firehose.sh](./scripts/start-firehose.sh)
  - starts the local Firehose pipeline
- [scripts/demo.sh](./scripts/demo.sh)
  - starts the pipeline and the CLI together
- [src/cli.js](./src/cli.js)
  - Node.js Firehose consumer

## Setup

### 1. Install Node dependencies

```bash
make install-node-deps
```

### 2. Install `firecore` and `firetron`

```bash
make install-tools
```

This installer builds from cloned source tags instead of using `go install module@version`, because the upstream modules currently include `replace` directives in `go.mod`.

By default, the binaries are installed into your Go bin directory, usually:

```bash
$HOME/go/bin
```

`make start-firehose` will look in `PATH`, `INSTALL_BIN_DIR`, `go env GOBIN`, and `go env GOPATH` automatically. Keeping your Go bin directory on `PATH` is still recommended:

```bash
export PATH="$HOME/go/bin:$PATH"
```

You can verify the tools are available:

```bash
which firecore
which firetron
firecore --help
firetron --help
```

### 3. Create your `.env`

```bash
cp .env.example .env
```

Example:

```bash
TRON_RPC_ENDPOINT=http://grpc.trongrid.io:50051
TRON_API_KEY=your-api-key
READER_NODE_START_BLOCK_NUM=1321000
FIREHOSE_ENDPOINT=127.0.0.1:8089
GO_BIN=go
```

Important transport note:

- `firetron` treats `http://...` as plaintext gRPC
- `firetron` treats `https://...` as TLS gRPC
- if you use only `host:port`, `firetron` defaults to TLS
- if your provider expects plaintext gRPC and you omit `http://`, startup can fail with:
  - `tls: first record does not look like a TLS handshake`

## Configuration Notes

### `TRON_RPC_ENDPOINT`

This is the remote TRON gRPC endpoint that `firetron` reads from.

Example:

```bash
TRON_RPC_ENDPOINT=http://grpc.trongrid.io:50051
```

### `TRON_API_KEY`

Your provider API key. `firetron` passes it to the TRON gRPC endpoint.

### `READER_NODE_START_BLOCK_NUM`

This is the block number the reader starts from.

Current default:

```bash
READER_NODE_START_BLOCK_NUM=1321000
```

That value comes from the upstream `firehose-tron` development config:

- https://github.com/streamingfast/firehose-tron/blob/main/devel/standard/standard.yaml

In this project, `1321000` is also the configured `common-first-streamable-block`, so it is effectively the earliest supported block for this pipeline.

### `FIREHOSE_ENDPOINT`

This is the local Firehose server exposed by `firecore`, not a TRON node.

Default:

```bash
FIREHOSE_ENDPOINT=127.0.0.1:8089
```

## Running

### Option A: Run the pipeline and consumer separately

Terminal 1:

```bash
make start-firehose
```

What this does:

- starts `firecore`
- `firecore` launches `firetron`
- `firetron` connects to `TRON_RPC_ENDPOINT`
- blocks are fetched from TRON mainnet
- `firecore` exposes a local Firehose endpoint on `127.0.0.1:8089`

Keep this terminal open.

Terminal 2:

```bash
make stream
```

What this does:

- starts the Node.js CLI
- connects to `FIREHOSE_ENDPOINT`
- reads blocks from the local Firehose server
- prints one summary line per block

Default behavior:

- starts near the head with `--start-block=-20`
- prints 10 blocks
- exits

### Option B: Run both together

```bash
make demo
```

What this does:

- starts `firecore` in the background
- waits for `127.0.0.1:8089` to become ready
- runs the Node.js CLI
- stops the background process when done

## CLI Usage

Print 10 block summaries:

```bash
make stream
```

Equivalent:

```bash
npm run stream --
```

Print full decoded TRON block JSON:

```bash
npm run stream -- --include-json
```

Print 50 blocks:

```bash
npm run stream -- --max-blocks=50
```

Stream continuously:

```bash
npm run stream -- --max-blocks=0
```

Start near the chain head:

```bash
npm run stream -- --start-block=-20 --max-blocks=5
```

Request final blocks only:

```bash
npm run stream -- --final-blocks-only --max-blocks=10
```

## Expected Output

Block summary lines look like:

```text
step=STEP_NEW num=75612345 id=... parent=... lib=... ts=2026-04-23T19:21:10.000Z txs=123 cursor=...
```

Fields:

- `step`
  - Firehose fork step, usually `STEP_NEW` or `STEP_FINAL`
- `num`
  - block number
- `id`
  - block id
- `parent`
  - parent block id
- `lib`
  - last irreversible block number reported by Firehose metadata
- `ts`
  - block timestamp
- `txs`
  - number of transactions in the block
- `cursor`
  - Firehose cursor for resuming later

## Local Data and Logs

The local pipeline stores working data under:

```bash
.data/
```

When you run:

```bash
make demo
```

`firecore` logs are written to:

```bash
.data/firecore.log
```

## Troubleshooting

### `tls: first record does not look like a TLS handshake`

Your `TRON_RPC_ENDPOINT` scheme is wrong for the provider.

For TronGrid in this setup, use:

```bash
TRON_RPC_ENDPOINT=http://grpc.trongrid.io:50051
```

Not:

```bash
TRON_RPC_ENDPOINT=grpc.trongrid.io:50051
```

### `firecore: command not found` or `firetron: command not found`

The startup script could not find the installed binaries.

Check that the tools are installed:

```bash
make install-tools
```

If you installed them into a custom location, point startup there:

```bash
INSTALL_BIN_DIR=/path/to/bin make start-firehose
```

Or add your Go bin directory to `PATH`:

```bash
export PATH="$HOME/go/bin:$PATH"
```

### `connection refused` on `127.0.0.1:8089`

The local Firehose server is not running yet, or `make start-firehose` crashed during startup.

### No blocks appear

Possible causes:

- invalid `TRON_API_KEY`
- wrong `TRON_RPC_ENDPOINT`
- provider does not expose the TRON gRPC `Wallet` API
- reader is starting too far back and is still catching up

## Current Scope

This project currently:

- fetches TRON data through `firetron`
- runs a local Firehose pipeline through `firecore`
- prints decoded blocks to the console from Node.js

This project does not yet:

- write to Postgres
- run a local TRON node
- provide a production deployment setup
