# syntax=docker/dockerfile:1

# 1. Build the PWA.
FROM node:24-alpine AS frontend
WORKDIR /src
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# 2. Python runtime that serves the API and the built PWA.
FROM python:3.14-slim AS runtime
COPY --from=ghcr.io/astral-sh/uv:0.12 /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1
WORKDIR /app

COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY backend/ ./
COPY --from=frontend /src/dist ./static

RUN useradd --system --uid 10001 app
# The version /api/health reports: CI passes the release (1.2.0) or the image's sha tag.
ARG HJ_VERSION=dev
ENV HJ_VERSION=$HJ_VERSION
# The web page of the commit it was built from, so the version links to it. Empty: plain text.
ARG HJ_COMMIT_URL=
ENV HJ_COMMIT_URL=$HJ_COMMIT_URL
# SQLite and uploads live in /data (mount a volume); report Markdown is read from /reports.
ENV HJ_DATA_DIR=/data \
    HJ_REPORTS_DIR=/reports
RUN mkdir /data && chown 10001:10001 /data
USER 10001
EXPOSE 8000
# X-Forwarded-* is trusted only from FORWARDED_ALLOW_IPS (uvicorn's setting, 127.0.0.1 when unset).
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
