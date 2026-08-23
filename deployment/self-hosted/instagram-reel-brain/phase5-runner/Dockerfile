FROM node:22-bookworm-slim

ARG CODEX_CLI_VERSION=0.147.0

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    CODEX_HOME=/home/node/.codex \
    CODEX_AUTH_SOURCE=/codex-auth/auth.json \
    REEL_PHASE5_RUNNER_ENABLED=false \
    REEL_PHASE5_PROCESSOR_PATH=/opt/reel/processor/app.py

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates ffmpeg git python3 python3-pip \
    && rm -rf /var/lib/apt/lists/*

RUN npm install --global "@openai/codex@${CODEX_CLI_VERSION}" \
    && npm cache clean --force

WORKDIR /opt/reel

COPY phase5-runner/container/requirements.txt /tmp/reel-requirements.txt
RUN pip3 install --break-system-packages --no-cache-dir -r /tmp/reel-requirements.txt

COPY phase5-runner/container/app.py /opt/reel/processor/app.py
COPY phase5-runner/container/synthesis-output.schema.json /opt/reel/processor/synthesis-output.schema.json
COPY scripts/phase5_one_job_runner.py /opt/reel/phase5_one_job_runner.py
COPY scripts/phase5_staged_runner.py /opt/reel/phase5_staged_runner.py
COPY scripts/phase6_dispatch_control.py /opt/reel/phase6_dispatch_control.py
COPY phase5-runner/phase5_runner_probe.py /opt/reel/phase5_runner_probe.py

RUN mkdir -p /codex-auth /work /runs /opt/reel/probe-output \
    && chown -R node:node /work /runs /opt/reel /home/node \
    && chmod 0755 /opt/reel/phase5_one_job_runner.py /opt/reel/phase5_staged_runner.py /opt/reel/phase6_dispatch_control.py /opt/reel/phase5_runner_probe.py

USER node
ENTRYPOINT ["python3", "/opt/reel/phase5_runner_probe.py"]
CMD ["inert-health"]
