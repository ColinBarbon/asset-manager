# Asset Manager — Express + sql.js
FROM node:20-alpine

WORKDIR /app

# Install production deps first for better layer caching.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

ENV PORT=3000
EXPOSE 3000

# Configure at runtime with -e APP_PASSWORD=… -e SESSION_SECRET=… (and JIRA_* if used).
CMD ["node", "server.js"]
