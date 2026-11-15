FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 DATA_FILE=/app/data/db.json
COPY package.json server.js ./
COPY public ./public
RUN npm install --omit=dev --no-audit --no-fund \
 && mkdir -p /app/data && chown -R node:node /app/data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "server.js"]
