FROM node:22-alpine

RUN apk add --no-cache curl \
    && HOME=/opt/codex curl -fsSL https://chatgpt.com/codex/install.sh | HOME=/opt/codex sh \
    && ln -s /opt/codex/.local/bin/codex /usr/local/bin/codex

WORKDIR /app
COPY runner/package.json ./
COPY runner/server.js runner/smoke-test.js runner/result.schema.json ./
RUN mkdir -p /work && chown -R node:node /work

ENV CODEX_HOME=/codex-auth
USER node
CMD ["node", "server.js"]
