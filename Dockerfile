FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server.js names.js og.js ./
COPY og ./og
COPY web ./web
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data WEB_ROOT=/app/web
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
CMD ["node", "server.js"]
