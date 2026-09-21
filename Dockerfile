# Aurora — file explorer + MCP artifact-preview host.
# Runs `cli.ts` directly under Bun; no build step (Bun executes TS natively).
FROM oven/bun:1

WORKDIR /app

# Install deps in their own layer so source edits don't bust the cache.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY . .

# /workspace: the directory Aurora serves as a file explorer (mount your project here).
# The artifact store defaults to $HOME/.local/share/aurora/artifacts (see server.ts) —
# mount a volume there to persist pushed artifacts across container restarts.
VOLUME ["/workspace", "/root/.local/share/aurora/artifacts"]
EXPOSE 7634

# Aurora binds to 127.0.0.1 by default (never reachable over the network).
# Inside a container that means loopback-only *within the container's own
# netns*, which Docker's port publishing can never reach — bind the container
# to all interfaces and preserve the "localhost only" guarantee at the
# publish step instead: `-p 127.0.0.1:7634:7634` (see run instructions).
ENV AURORA_HOST=0.0.0.0

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD bun -e "fetch('http://127.0.0.1:7634/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["bun", "cli.ts"]
CMD ["/workspace", "--port", "7634"]
