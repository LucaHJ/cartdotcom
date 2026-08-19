FROM node:22-alpine

WORKDIR /app
COPY auth-rotator/*.js ./

USER node
CMD ["node", "server.js"]
