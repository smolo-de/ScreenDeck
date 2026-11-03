# ScreenDeck als Container – Start am einfachsten mit: docker compose up -d
# Daten (Playlisten, Uploads, Einstellungen) liegen im Volume /data.
FROM node:24-slim

WORKDIR /app
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=3000 \
    EXTRA_PORT=0

# Abhängigkeiten zuerst (bleiben im Cache, solange sich package*.json nicht ändern)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# npm wird zur Laufzeit nicht gebraucht – weniger Angriffsfläche, seine Abhängigkeiten fallen beim Scan nicht mehr an
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

COPY server.js LICENSE ./
COPY public ./public

# nicht als root laufen
RUN mkdir -p /data && chown node:node /data
USER node

EXPOSE 3000
VOLUME /data
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD node -e "fetch('http://localhost:3000/connect.json').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

CMD ["node", "server.js"]
