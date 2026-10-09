FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npx vite build --configLoader runner

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    ARCHFLOW_HOST=0.0.0.0 \
    ARCHFLOW_PORT=7077 \
    ARCHFLOW_DATA=/data/diagrams \
    ARCHFLOW_CONFIG=/data/config \
    ARCHFLOW_DIST=/app/dist
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server ./server
COPY src ./src
RUN mkdir -p /data && chown -R node:node /data /app
USER node
EXPOSE 7077
VOLUME /data
CMD ["npx", "tsx", "server/bridge.ts"]
