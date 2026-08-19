FROM node:22-alpine

WORKDIR /app
COPY market/package.json market/package-lock.json ./
RUN npm ci --omit=dev
COPY market/*.js ./market/
COPY common/*.js ./common/

USER node
CMD ["node", "market/tracker.js"]
