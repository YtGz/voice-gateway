FROM oven/bun:1-debian

WORKDIR /app

# Install ALSA for audio support
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    alsa-utils \
    libasound2 \
    && rm -rf /var/lib/apt/lists/*

# Install dependencies
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copy source
COPY . .

# Create wakewords directory
RUN mkdir -p /app/wakewords

CMD ["bun", "run", "start"]
