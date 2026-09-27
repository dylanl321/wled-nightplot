# Nightplot Configure — production-*shaped* image, not production certified.
# One image. Process model (see docker-entrypoint.sh):
#   api | web | all (default)
# Web rewrites /api and /health to http://127.0.0.1:43181 — compose puts
# web on the API network namespace; `all` is the same loopback.

FROM node:20-bookworm-slim AS base
WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH="${PNPM_HOME}:${PATH}"
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.33.3 --activate

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/web/package.json apps/web/package.json
COPY apps/server/package.json apps/server/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
# Baked into Next rewrites at `next build`. Loopback: web shares the API netns,
# or both run in `all`. Rebuild with this ARG only if you split onto a bridge.
ARG NIGHTPLOT_API_URL=http://127.0.0.1:43181
ENV NIGHTPLOT_API_URL=${NIGHTPLOT_API_URL}
RUN pnpm --filter @nightplot/web build

FROM base AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends tini ca-certificates \
  && rm -rf /var/lib/apt/lists/*
LABEL org.opencontainers.image.source="https://github.com/dylanl321/wled-nightplot"
LABEL org.opencontainers.image.title="nightplot-configure"
LABEL org.opencontainers.image.description="Nightplot Configure image. Not production certified."
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV NIGHTPLOT_API_URL=http://127.0.0.1:43181
ENV NIGHTPLOT_API_HOST=0.0.0.0
ENV NIGHTPLOT_API_PORT=43181
ENV NIGHTPLOT_WEB_HOST=0.0.0.0
ENV NIGHTPLOT_WEB_PORT=43180
ENV NIGHTPLOT_STORE_PATH=/data/lights.json
ENV NIGHTPLOT_LED_PRODUCTS_PATH=/data/led-products.json
COPY --from=build /app /app
RUN chmod +x /app/docker-entrypoint.sh \
  && mkdir -p /data \
  && chown -R node:node /app /data
USER node
EXPOSE 43180 43181
VOLUME ["/data"]
ENTRYPOINT ["/usr/bin/tini", "--", "/app/docker-entrypoint.sh"]
CMD ["all"]
