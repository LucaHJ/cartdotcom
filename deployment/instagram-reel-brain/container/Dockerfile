FROM node:22-bookworm-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    CODEX_HOME=/home/codex/.codex

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates ffmpeg git python3 python3-pip \
    && rm -rf /var/lib/apt/lists/*

RUN npm install --global @openai/codex@0.147.0

WORKDIR /app
COPY requirements.txt ./requirements.txt
RUN pip3 install --break-system-packages --no-cache-dir -r requirements.txt

COPY app.py ./app.py
COPY synthesis-output.schema.json ./synthesis-output.schema.json

RUN useradd --create-home --uid 10001 codex \
    && mkdir -p /home/codex/.codex /work \
    && chown -R codex:codex /home/codex /work /app

USER codex
EXPOSE 8080
CMD ["python3", "/app/app.py"]
