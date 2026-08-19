FROM python:3.12-slim

WORKDIR /app
RUN apt-get update \
    && apt-get install --yes --no-install-recommends sqlite3 \
    && rm -rf /var/lib/apt/lists/*
COPY requirements.txt ./
RUN pip install --no-cache-dir --requirement requirements.txt

COPY d1_import.py ./

USER 65534:65534
ENTRYPOINT ["python", "/app/d1_import.py"]
