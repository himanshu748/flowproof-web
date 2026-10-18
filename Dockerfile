FROM node:22-bookworm-slim

# Official development server only. Pinned release/checksum also used by CI.
# Loopback binding and SQLite storage are enforced by hosted-temporal.ts.
ADD https://github.com/temporalio/cli/releases/download/v1.9.1/temporal_cli_1.9.1_linux_amd64.tar.gz /tmp/temporal-cli.tar.gz
RUN echo "09a0326a51db84d02735e53542b9ebd8c4758daf47482a9ab0abce15844e60d5  /tmp/temporal-cli.tar.gz" | sha256sum --check --strict \
    && tar -xzf /tmp/temporal-cli.tar.gz -C /usr/local/bin temporal \
    && rm /tmp/temporal-cli.tar.gz

WORKDIR /app
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps \
    && npx playwright install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/*
COPY . .
RUN npm run build \
    && mkdir -p /app/data /app/work \
    && chown -R node:node /app/data /app/work

ENV NODE_ENV=production
ENV PORT=10000
USER node
EXPOSE 10000
CMD ["npm", "start"]
