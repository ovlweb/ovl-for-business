# Static single-page apps (web client, admin panel) served by nginx.
# Build from the repository root:
#   docker build -f deploy/docker/static.Dockerfile --build-arg APP=@ovl/web   --build-arg APP_DIR=clients/web -t ovl-web .
#   docker build -f deploy/docker/static.Dockerfile --build-arg APP=@ovl/admin --build-arg APP_DIR=admin       -t ovl-admin .
FROM node:22-alpine AS build
ARG APP
ARG APP_DIR
WORKDIR /repo
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/sdk/package.json packages/sdk/
COPY packages/ui/package.json packages/ui/
COPY ${APP_DIR}/package.json ${APP_DIR}/
RUN pnpm install --frozen-lockfile --filter "${APP}..."
COPY packages packages
COPY ${APP_DIR} ${APP_DIR}
RUN pnpm --filter "${APP}" build && cp -r ${APP_DIR}/dist /site

FROM nginx:1.29-alpine
COPY deploy/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY deploy/docker/40-ovl-config.sh /docker-entrypoint.d/40-ovl-config.sh
COPY --from=build /site /usr/share/nginx/html
RUN chmod +x /docker-entrypoint.d/40-ovl-config.sh
EXPOSE 80
