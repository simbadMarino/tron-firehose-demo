#!/usr/bin/env node

require("dotenv").config({ quiet: true });

const fs = require("node:fs");
const path = require("node:path");
const process = require("node:process");

const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const protobuf = require("protobufjs");
const googleProtoFiles = require("google-proto-files");

const repoRoot = path.resolve(__dirname, "..");
const protoRootDir = path.join(repoRoot, "proto");
const googleProtoDir = path.dirname(
  googleProtoFiles.getProtoPath("protobuf/any.proto")
);

const firehoseProtoPath = path.join(protoRootDir, "sf/firehose/v2/firehose.proto");
const tronBlockProtoPath = path.join(protoRootDir, "sf/tron/type/v1/block.proto");

const packageDefinition = protoLoader.loadSync(firehoseProtoPath, {
  includeDirs: [protoRootDir, googleProtoDir],
  longs: Number,
  enums: String,
  bytes: Buffer,
  defaults: true,
  oneofs: true,
});

const grpcPackage = grpc.loadPackageDefinition(packageDefinition);
const StreamClient = grpcPackage.sf.firehose.v2.Stream;

const tronRoot = new protobuf.Root();
tronRoot.resolvePath = resolveProtoPath;
tronRoot.loadSync([tronBlockProtoPath], { keepCase: true });
tronRoot.resolveAll();

const TronBlock = tronRoot.lookupType("sf.tron.type.v1.Block");

async function main(argv) {
  const [command, ...rest] = argv;

  if (!command || command === "help" || command === "--help" || command === "-h") {
    printUsage();
    return;
  }

  if (command !== "stream") {
    throw new Error(`unknown command "${command}"`);
  }

  const options = parseFlags(rest, {
    endpoint: process.env.FIREHOSE_ENDPOINT || "127.0.0.1:8089",
    startBlock: -20,
    maxBlocks: 10,
    includeJson: false,
    finalBlocksOnly: false,
  });

  await streamBlocks(options);
}

function resolveProtoPath(origin, target) {
  const candidates = [];

  if (origin) {
    candidates.push(path.resolve(path.dirname(origin), target));
  }

  candidates.push(path.resolve(protoRootDir, target));
  candidates.push(path.resolve(googleProtoDir, target));

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return target;
}

function parseFlags(args, defaults) {
  const options = { ...defaults };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--help" || arg === "-h") {
      printStreamUsage();
      process.exit(0);
    }

    if (arg === "--include-json") {
      options.includeJson = true;
      continue;
    }

    if (arg === "--final-blocks-only") {
      options.finalBlocksOnly = true;
      continue;
    }

    const [rawKey, inlineValue] = arg.split("=", 2);
    const key = rawKey.startsWith("--") ? rawKey.slice(2) : null;
    const nextValue = inlineValue ?? args[index + 1];

    switch (key) {
      case "endpoint":
        options.endpoint = expectValue(key, nextValue);
        if (inlineValue === undefined) index += 1;
        break;
      case "start-block":
        options.startBlock = Number(expectValue(key, nextValue));
        if (inlineValue === undefined) index += 1;
        break;
      case "max-blocks":
        options.maxBlocks = Number(expectValue(key, nextValue));
        if (inlineValue === undefined) index += 1;
        break;
      default:
        throw new Error(`unknown flag "${arg}"`);
    }
  }

  if (!Number.isInteger(options.startBlock)) {
    throw new Error("--start-block must be an integer");
  }

  if (!Number.isInteger(options.maxBlocks) || options.maxBlocks < 0) {
    throw new Error("--max-blocks must be a non-negative integer");
  }

  return options;
}

function expectValue(flagName, value) {
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`missing value for --${flagName}`);
  }

  return value;
}

async function streamBlocks(options) {
  const client = new StreamClient(
    options.endpoint,
    grpc.credentials.createInsecure()
  );

  const request = {
    start_block_num: options.startBlock,
    final_blocks_only: options.finalBlocksOnly,
  };

  const stream = client.Blocks(request);
  let received = 0;

  const closeClient = () => {
    try {
      client.close();
    } catch {
      // grpc-js close is idempotent enough for this CLI.
    }
  };

  const onSignal = () => {
    stream.cancel();
    closeClient();
  };

  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  try {
    for await (const response of toAsyncIterator(stream)) {
      const block = decodeTronBlock(response.block);

      console.log(renderSummary(response, block));

      if (options.includeJson) {
        const object = TronBlock.toObject(block, {
          longs: String,
          enums: String,
          bytes: String,
        });

        console.log(JSON.stringify(object, null, 2));
      }

      received += 1;
      if (options.maxBlocks > 0 && received >= options.maxBlocks) {
        stream.cancel();
        break;
      }
    }
  } finally {
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
    closeClient();
  }
}

function decodeTronBlock(anyMessage) {
  if (!anyMessage || !Buffer.isBuffer(anyMessage.value)) {
    throw new Error("firehose response did not contain a binary Any payload");
  }

  return TronBlock.decode(anyMessage.value);
}

function renderSummary(response, block) {
  const header = block.header || {};
  const metadata = response.metadata || {};

  return [
    `step=${response.step}`,
    `num=${metadata.num || header.number || 0}`,
    `id=${metadata.id || toHex(block.id)}`,
    `parent=${metadata.parent_id || toHex(header.parent_hash)}`,
    `lib=${metadata.lib_num || 0}`,
    `ts=${formatTimestamp(metadata.time, header.timestamp)}`,
    `txs=${Array.isArray(block.transactions) ? block.transactions.length : 0}`,
    `cursor=${response.cursor || ""}`,
  ].join(" ");
}

function formatTimestamp(metadataTime, blockTimestampMs) {
  if (metadataTime && Number.isFinite(metadataTime.seconds)) {
    const milliseconds = metadataTime.seconds * 1000 + Math.floor((metadataTime.nanos || 0) / 1e6);
    return new Date(milliseconds).toISOString();
  }

  if (Number.isFinite(blockTimestampMs) && blockTimestampMs > 0) {
    return new Date(blockTimestampMs).toISOString();
  }

  return "";
}

function toHex(bytes) {
  if (!bytes) {
    return "";
  }

  if (Buffer.isBuffer(bytes)) {
    return bytes.toString("hex");
  }

  if (Array.isArray(bytes)) {
    return Buffer.from(bytes).toString("hex");
  }

  return String(bytes);
}

function toAsyncIterator(stream) {
  const queue = [];
  const waiters = [];
  let ended = false;
  let failure = null;

  stream.on("data", (data) => {
    if (waiters.length > 0) {
      const waiter = waiters.shift();
      waiter.resolve({ value: data, done: false });
      return;
    }

    queue.push(data);
  });

  stream.on("end", () => {
    ended = true;

    while (waiters.length > 0) {
      waiters.shift().resolve({ value: undefined, done: true });
    }
  });

  stream.on("error", (error) => {
    if (error && error.code === grpc.status.CANCELLED) {
      ended = true;

      while (waiters.length > 0) {
        waiters.shift().resolve({ value: undefined, done: true });
      }

      return;
    }

    failure = error;
    while (waiters.length > 0) {
      waiters.shift().reject(error);
    }
  });

  return {
    [Symbol.asyncIterator]() {
      return {
        next() {
          if (queue.length > 0) {
            return Promise.resolve({ value: queue.shift(), done: false });
          }

          if (failure) {
            return Promise.reject(failure);
          }

          if (ended) {
            return Promise.resolve({ value: undefined, done: true });
          }

          return new Promise((resolve, reject) => {
            waiters.push({ resolve, reject });
          });
        },
      };
    },
  };
}

function printUsage() {
  process.stdout.write(`Usage:
  node src/cli.js stream [flags]

Commands:
  stream    connect to a Firehose endpoint and print TRON blocks
`);
}

function printStreamUsage() {
  process.stdout.write(`stream flags:
  --endpoint           Firehose gRPC endpoint (default: FIREHOSE_ENDPOINT or 127.0.0.1:8089)
  --start-block        Inclusive start block; negatives are relative to chain head (default: -20)
  --max-blocks         Stop after this many blocks; 0 means no limit (default: 10)
  --include-json       Print the decoded TRON block payload as JSON
  --final-blocks-only  Request only final blocks
`);
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
