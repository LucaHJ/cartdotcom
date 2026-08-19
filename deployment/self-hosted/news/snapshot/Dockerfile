FROM node:22-alpine

WORKDIR /app
COPY package.json ./
COPY publisher.js snapshot.js healthcheck.js ./

USER node
CMD ["node", "publisher.js"]
