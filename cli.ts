#!/usr/bin/env bun
import { resolve } from "node:path";
import { createServer } from "./server";

function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  let port = 3000;
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--port") {
      port = Number(args[++i]);
    } else {
      positional.push(arg);
    }
  }
  const rootDir = positional[0];
  if (!rootDir) {
    console.error("Usage: zui-explorer <path> [--port <port>]");
    process.exit(1);
  }
  return { rootDir: resolve(rootDir), port };
}

const { rootDir, port } = parseArgs(process.argv);
const server = createServer(rootDir, port);
console.log(`zui-explorer serving ${rootDir} at http://localhost:${server.port}`);
