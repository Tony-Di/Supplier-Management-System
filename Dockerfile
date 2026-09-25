# Builds the frontend, then runs the API with tsx, which also serves the built
# frontend from the same origin (required by the session cookie).

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV API_PORT=5174
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server ./server
COPY src ./src
COPY scripts ./scripts
COPY migrations ./migrations
# data/ holds the business records (store.json) and uploads/ the uploaded
# files; both are mounted as volumes by compose.intranet.yml.
RUN mkdir -p data uploads && chown node:node data uploads
USER node
EXPOSE 5174
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:5174/api/health || exit 1
CMD ["sh", "-c", "npm run migrate && npm start"]
