FROM node:22-alpine AS frontend-builder

WORKDIR /build

COPY package.json package-lock.json ./
RUN npm ci

COPY index.html ./
COPY src ./src
COPY public ./public

RUN npm run build


FROM golang:1.24-alpine AS backend-builder

WORKDIR /build

COPY go.mod go.sum ./
RUN go mod download

COPY cmd ./cmd

RUN CGO_ENABLED=0 GOOS=linux go build \
    -trimpath \
    -ldflags="-s -w" \
    -o /gallery \
    ./cmd/server


FROM alpine:3.22

RUN apk add --no-cache ca-certificates curl \
    && adduser -D -H -u 10001 gallery

WORKDIR /app

COPY --from=backend-builder /gallery ./gallery
COPY --from=frontend-builder /build/dist ./dist

USER gallery

ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
    CMD ["curl", "--fail", "--silent", "--show-error", "http://127.0.0.1:3000/api/health"]

ENTRYPOINT ["./gallery"]
