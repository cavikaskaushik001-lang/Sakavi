# Secure AI Coding Sandbox Image
# - Non-root user
# - Essential language toolchains only
# - No Docker socket, no privileged mode, no host secrets

FROM node:22-bookworm-slim

LABEL maintainer="sakavi-sandbox"
LABEL description="Isolated coding environment for AI agents"

# Install system packages + Python + git (minimal)
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    python3 \
    python3-pip \
    python3-venv \
    curl \
    ca-certificates \
    build-essential \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Create non-root user (UID 1000) with home and workspace ownership
RUN groupadd --gid 1000 sandbox \
    && useradd --uid 1000 --gid sandbox --shell /bin/bash --create-home sandbox \
    && mkdir -p /workspace \
    && chown -R sandbox:sandbox /workspace /home/sandbox

# Switch to non-root
USER sandbox
WORKDIR /workspace

# Default environment (no secrets)
ENV HOME=/home/sandbox \
    PATH="/home/sandbox/.local/bin:$PATH" \
    npm_config_cache=/tmp/npm-cache \
    PIP_CACHE_DIR=/tmp/pip-cache \
    PYTHONUNBUFFERED=1 \
    NODE_ENV=development

# Pre-create cache dirs owned by sandbox
RUN mkdir -p /tmp/npm-cache /tmp/pip-cache

# Healthcheck (simple)
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=2 \
  CMD node -e "process.exit(0)" || exit 1

# Keep container alive when started without a command
CMD ["sleep", "infinity"]
