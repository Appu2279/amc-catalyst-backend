# syntax=docker/dockerfile:1

# Debian slim rather than Alpine on purpose: bcrypt ships prebuilt binaries for
# glibc. On Alpine's musl there are none, so it compiles from source and the
# image then needs python3, make and g++ — a bigger image and a slower build.

# ── deps ─────────────────────────────────────────────────────────────────────
FROM node:22-slim AS deps
WORKDIR /app

# Copied on their own so this layer is only rebuilt when dependencies change,
# not on every source edit.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ── runtime ──────────────────────────────────────────────────────────────────
FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Ghostscript compresses oversized note PDFs before they go to storage, which
# caps raw files at 10 MiB. Without it the API still runs and still serves
# notes — only uploads above that ceiling fail, with a message saying why.
# --no-install-recommends keeps this to the engine and its fonts rather than
# pulling in X11.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ghostscript \
 && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY scripts ./scripts
COPY seeders ./seeders
COPY config ./config

# The official image ships an unprivileged "node" user. Running as root inside
# the container means a container escape starts as root on the host.
USER node

EXPOSE 3000

# Reports whether the API is actually serving, not merely that the process is
# alive — a Node process can be up while the event loop is wedged.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# No nodemon, no npm wrapper: npm swallows signals, so `docker stop` would sit
# through the full timeout instead of shutting down promptly.
CMD ["node", "src/server.js"]
