FROM nginx:stable-alpine@sha256:ed84151ed2d47ef93c0939eb9b9754c6990db6092cd2081e11988a47a83d47ea AS runtime
COPY containers/nginx.conf /etc/nginx/nginx.conf
USER 101:101
EXPOSE 8080
ENTRYPOINT []
CMD ["nginx", "-g", "daemon off;"]
HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=4 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1

# Reuse a verified local/CI build on a small VPS: --target prebuilt.
FROM runtime AS prebuilt
COPY dist/ /usr/share/nginx/html/

# The default image builds the frontend from the locked source dependencies.
FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json vite.config.ts index.html terminal.html credits.html login.html ./
COPY src/ ./src/
COPY public/ ./public/
COPY scripts/ ./scripts/
RUN npm run build

FROM runtime AS web
COPY --from=build /app/dist/ /usr/share/nginx/html/
