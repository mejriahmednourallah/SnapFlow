# Stage 1: Build the Go binary
FROM golang:alpine AS builder
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

# Stage 2: Minimal runtime with Chromium for go-rod
FROM alpine:3.19
RUN apk add --no-cache chromium ca-certificates tzdata
ENV CHROME_PATH=/usr/bin/chromium-browser
WORKDIR /app
COPY --from=builder /v3-scanner-go .
ENTRYPOINT ["./v3-scanner-go"]
