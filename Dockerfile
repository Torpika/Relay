# syntax=docker/dockerfile:1.7

FROM node:24-bookworm-slim AS dependencies
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@11.9.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM dependencies AS build
COPY . .
RUN pnpm build

FROM node:24-bookworm-slim AS web
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
WORKDIR /app
RUN groupadd --system --gid 1001 relay && useradd --system --uid 1001 --gid relay relay
COPY --from=build --chown=relay:relay /app/.next/standalone ./
COPY --from=build --chown=relay:relay /app/.next/static ./.next/static
COPY --from=build --chown=relay:relay /app/public ./public
USER relay
EXPOSE 3000
CMD ["node", "server.js"]

FROM dependencies AS worker
ENV NODE_ENV=production
WORKDIR /app
COPY . .
CMD ["pnpm", "worker"]
