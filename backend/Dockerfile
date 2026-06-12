FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --legacy-peer-deps
COPY . .
RUN npm run build

FROM node:20-alpine
# No `apk add` here on purpose: Alpine's package CDN (dl-cdn.alpinelinux.org)
# intermittently black-holes over IPv6 from the VDS, which made `apk add wget`
# hang for hours on an uncached build and blocked deploys. The container
# healthcheck now uses Node's built-in http (see docker-compose.yml), so the
# image needs no extra packages and the build never touches the apk network.
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json .
COPY --from=builder /app/migrations ./migrations
RUN mkdir -p uploads
EXPOSE 3000
CMD ["node", "dist/main"]
