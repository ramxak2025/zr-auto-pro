FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod ./
COPY main.go ./
RUN CGO_ENABLED=0 GOOS=linux go build -o webhook .

FROM alpine:3.19
RUN apk add --no-cache bash git docker-cli docker-compose
WORKDIR /app
COPY --from=builder /app/webhook .
EXPOSE 9000
CMD ["./webhook"]
