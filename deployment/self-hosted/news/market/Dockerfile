FROM node:22-alpine

WORKDIR /app
COPY market/package.json market/package-lock.json ./
RUN npm ci --omit=dev
COPY market/*.js ./

USER node
CMD ["node", "tracker.js"]
