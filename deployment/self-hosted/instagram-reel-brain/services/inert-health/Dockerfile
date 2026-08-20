FROM node:20-alpine

WORKDIR /app
COPY package.json ./
COPY server.js healthcheck.js ./

USER node
CMD ["node", "server.js"]
