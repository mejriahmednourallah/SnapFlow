# Stage 1: Build the Go binary
FROM golang:1.25.12-alpine3.23 AS builder
RUN apk add --no-cache git
WORKDIR /app
COPY go.mod go.sum ./
ARG GOPROXY=https://proxy.golang.org,direct
ENV GOPROXY=${GOPROXY}
ENV GOSUMDB=sum.golang.org
RUN set -eux; \
		ok=0; \
		for i in 1 2 3 4 5; do \
			if go mod download; then ok=1; break; fi; \
			echo "go mod download failed (attempt ${i}/5), retrying..."; \
			sleep $((i * 3)); \
		done; \
		test "$ok" -eq 1
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /v3-scanner-go .

# Stage 2: Minimal runtime — browser rendering is delegated to v3-browser-pool.
# Chromium is no longer installed here; set BROWSER_POOL_URL to enable the pool.
FROM alpine:3.22
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app
COPY --from=builder /v3-scanner-go .
ENTRYPOINT ["./v3-scanner-go"]
