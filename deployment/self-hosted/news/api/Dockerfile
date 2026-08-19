FROM node:22-alpine

WORKDIR /app
COPY api/package.json api/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY api/server.js api/predictions.js api/analytics.js api/dashboard-contract-check.js api/healthcheck.js api/events-check.js api/dashboard.html ./
COPY common/*.js ./common/

USER node
EXPOSE 3000
CMD ["node", "server.js"]
