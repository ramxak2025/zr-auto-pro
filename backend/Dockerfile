FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --legacy-peer-deps
COPY . .
RUN npm run build

FROM node:20-alpine
RUN apk add --no-cache wget
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json .
COPY --from=builder /app/migrations ./migrations
RUN mkdir -p uploads
EXPOSE 3000
CMD ["node", "dist/main"]
