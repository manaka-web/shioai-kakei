FROM node:22-bookworm-slim
WORKDIR /app
COPY --chown=node:node server.mjs package.json ./
USER node
CMD ["node", "server.mjs"]
