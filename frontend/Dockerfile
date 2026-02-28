FROM node:20-alpine AS builder
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY shared/ /shared/
RUN cd /shared && npm install
COPY frontend/ .
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
RUN mkdir -p /app/uploads
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
