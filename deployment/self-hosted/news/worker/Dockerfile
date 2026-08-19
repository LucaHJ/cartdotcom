FROM node:22-alpine

WORKDIR /app
COPY worker/package.json worker/package-lock.json ./
RUN npm ci --omit=dev
COPY worker/*.js worker/*.json ./worker/
COPY common/*.js ./common/

USER node
CMD ["node", "worker/worker.js"]
