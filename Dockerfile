FROM node:22-bookworm-slim

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
