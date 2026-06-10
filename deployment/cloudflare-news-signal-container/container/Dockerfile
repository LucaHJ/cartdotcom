FROM node:22-bookworm-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    CODEX_HOME=/home/codex/.codex \
    PORT=8080

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip python3-venv ca-certificates git \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g @openai/codex@0.139.0

WORKDIR /app
COPY requirements.txt /app/requirements.txt
RUN python3 -m pip install --break-system-packages --no-cache-dir -r /app/requirements.txt

COPY app.py /app/app.py

RUN useradd --create-home --shell /bin/bash codex \
    && mkdir -p /workspace /home/codex/.codex \
    && chown -R codex:codex /workspace /home/codex /app

USER codex
WORKDIR /workspace

EXPOSE 8080
CMD ["python3", "/app/app.py"]
