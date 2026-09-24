# API server image. Build from the repository root:
#   docker build -f server/Dockerfile -t ovl-server .
FROM node:22-alpine AS build
WORKDIR /repo
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/sdk/package.json packages/sdk/
COPY server/package.json server/
RUN pnpm install --frozen-lockfile --filter @ovl/server...
COPY packages/shared packages/shared
COPY packages/sdk packages/sdk
COPY server server
RUN pnpm --filter @ovl/server build \
 && pnpm --filter @ovl/server deploy --prod --legacy /out

FROM node:22-alpine
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4000 \
    RUN_MIGRATIONS=true
WORKDIR /app
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /repo/server/package.json ./package.json
COPY --from=build /repo/server/dist ./dist
COPY --from=build /repo/server/drizzle ./drizzle
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s CMD wget -qO- http://127.0.0.1:4000/health >/dev/null || exit 1
CMD ["node", "dist/index.js"]
