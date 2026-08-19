FROM node:22-alpine

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server.js predictions.js analytics.js dashboard-contract-check.js healthcheck.js events-check.js dashboard.html ./

USER node
EXPOSE 3000
CMD ["node", "server.js"]
