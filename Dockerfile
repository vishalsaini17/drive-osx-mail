# syntax=docker/dockerfile:1
#
# SMTP gateway. Same target layout as the API image: `dev` for watch mode,
# `production` for compiled output with runtime dependencies only.

ARG NODE_VERSION=24.13-alpine

# ---------------------------------------------------------------- dependencies
FROM node:${NODE_VERSION} AS deps

WORKDIR /app

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts

# ----------------------------------------------------------------------- build
FROM deps AS build

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ------------------------------------------------------- dependencies (dev)
# Installed as the `node` user so node_modules is writable at runtime. The dev
# server writes its dependency cache into node_modules, and the anonymous
# volume Compose creates from this directory inherits these permissions.
FROM node:${NODE_VERSION} AS deps-dev

WORKDIR /app
RUN chown node:node /app
USER node

COPY --chown=node:node package.json package-lock.json ./
RUN --mount=type=cache,target=/home/node/.npm,uid=1000,gid=1000 npm ci --ignore-scripts

# ------------------------------------------------------------------------- dev
FROM deps-dev AS dev

ENV NODE_ENV=development

COPY --chown=node:node . .

EXPOSE 2525

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "const s=require('net').connect(Number(process.env.PORT||2525),'127.0.0.1');s.on('connect',()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1))"

CMD ["npm", "run", "dev"]

# ------------------------------------------------------------------ production
FROM node:${NODE_VERSION} AS production

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=build --chown=node:node /app/dist ./dist

USER node

EXPOSE 2525

# SMTP has no HTTP endpoint; a completed TCP handshake is the liveness signal.
HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=5 \
  CMD node -e "const s=require('net').connect(Number(process.env.PORT||2525),'127.0.0.1');s.on('connect',()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1))"

CMD ["node", "dist/main.js"]
