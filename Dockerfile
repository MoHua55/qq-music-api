FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build:js

FROM node:24-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=3200 \
    QQ_AUTH_STATE_PATH=/app/.auth-state/qq-device.json \
    QQ_AUTH_SESSION_PATH=/app/.auth-state/qq-sessions.json
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
RUN mkdir -p /app/.auth-state && chown node:node /app/.auth-state
USER node
VOLUME ["/app/.auth-state"]
EXPOSE 3200
CMD ["node", "dist/src/app.js"]
