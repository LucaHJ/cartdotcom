FROM node:22-alpine

WORKDIR /app
COPY scheduler/package.json scheduler/package-lock.json ./
RUN npm ci --omit=dev
COPY scheduler/*.js ./scheduler/
COPY common/*.js ./common/

USER node
CMD ["node", "scheduler/scheduler.js"]
