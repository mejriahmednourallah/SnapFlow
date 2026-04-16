# SnapFlow V3 CLI

A production-grade developer console for SnapFlow V3.

## Prerequisites
- Go 1.22+
- Docker (for monitor log tailing)
- pinggy.io account (for deploy tunnel)

## Installation

```bash
make build
cp ./bin/snapflow /usr/local/bin/
```

## Setup

Create a `.snapflow.yaml` config file in your current directory or `~/.snapflow.yaml`:

```yaml
api_url:     http://localhost:8080    # v3-aggregator
scanner_url: http://localhost:8081    # v3-scanner-go

build:
  cgo_enabled: "0"
  goos:        linux
  goarch:      amd64
  output:      ./bin/scanner
  source:      ./v3-scanner-go
  extra_flags: []                     

deploy:
  pinggy_token:  "your-token-here"    # required for deploy command
  target_port:   8080
  tunnel_region: ""                   

monitor:
  poll_interval_ms:   2000
  log_lines_buffer:   200             
  services:
    - name: scanner
      url:  http://localhost:8081/health
    - name: aggregator
      url:  http://localhost:8080/health
    - name: nlp-worker
      check: docker                   
      container: v3-nlp-worker
    - name: db
      check: docker
      container: snapflow-db
```

## Usage

Run interactive menu:
```bash
snapflow
```

Or run commands directly:
```bash
snapflow monitor
snapflow build
snapflow deploy
snapflow scan https://example.com --watch
snapflow scan status scan_12345
```

## Screenshots
*(Add screenshots of Monitor, Deploy, and Build screens here)*
