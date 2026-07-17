# Deterministic production image for the Sarix Go backend (Telegram bot + HTTP API).
#
# Why this exists: Railway's automatic builder (Railpack/Nixpacks) intermittently failed
# with "Could not open requirements file: requirements.txt" even though the file is at the
# repository root. Pinning an explicit Dockerfile removes all builder guesswork: the build
# context is the repo root, dependencies install from the committed lock file, and the
# start command is fixed. This mirrors the Procfile (`python main.py`).

FROM python:3.11-slim

# Faster, cleaner Python in containers.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Install dependencies first so this layer is cached until the requirements change.
# requirements.txt pins transitive versions via `-c requirements-prod.lock`, so both
# files must be present before the install runs.
COPY requirements.txt requirements-prod.lock ./
RUN pip install -r requirements.txt

# Copy the rest of the backend source (app/, main.py, fonts, etc.).
COPY . .

# Same entry point as the Procfile: starts the bot and the aiohttp API server.
CMD ["python", "main.py"]
