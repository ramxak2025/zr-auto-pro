FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm config set strict-ssl false && npm ci
COPY . .
RUN npm run build

FROM node:20-alpine

WORKDIR /app
COPY package*.json ./
RUN npm config set strict-ssl false && npm ci --omit=dev
COPY --from=builder /app/dist ./dist

RUN mkdir -p uploads

EXPOSE 3000
CMD ["node", "dist/main"]
