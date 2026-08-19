FROM node:22-alpine

WORKDIR /app
COPY corpus/package.json corpus/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY corpus/*.js ./corpus/
COPY common/*.js ./common/

USER node
CMD ["node", "corpus/archiver.js"]
