#!/usr/bin/env bun
import { createServer } from "./server";

const USAGE = "Usage: aurora [--port <port>]";

function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  let port = 7634;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--port") {
      const value = Number(args[++i]);
      if (Number.isNaN(value)) {
        console.error(USAGE);
        process.exit(1);
      }
      port = value;
    } else {
      // The explorer's positional directory argument is gone; reject stray args loudly
      // instead of silently serving the artifact host with a typo'd flag.
      console.error(`Unexpected argument: ${arg}\n${USAGE}`);
      process.exit(1);
    }
  }
  return { port };
}

const { port } = parseArgs(process.argv);
const server = createServer(port);
console.log(`aurora listening at http://localhost:${server.port}`);
