FROM golang:1.24-alpine AS builder
WORKDIR /app

# Skip network-dependent sum verification — all checksums already in go.sum
ENV GONOSUMDB=*
ENV GONOSUMCHECK=*
ENV GOFLAGS=-mod=mod

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o server ./cmd/server

FROM alpine:3.19
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app
COPY --from=builder /app/server .
COPY --from=builder /app/migrations ./migrations
RUN mkdir -p uploads
EXPOSE 3000
CMD ["./server"]
