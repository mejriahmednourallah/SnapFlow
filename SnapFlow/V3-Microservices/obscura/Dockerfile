# Local candidate build. Defaults in production remain unchanged until acceptance.
FROM rust:1-slim-bookworm@sha256:452176c0cefca88c0b3184ce85a4eb03e3d4fa05d2afb5366abcba853221019e AS builder
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates git perl make cmake clang libclang-dev pkg-config python3 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /build
COPY build-input/upstream.tar.gz /tmp/upstream.tar.gz
COPY source.lock.json /tmp/source.lock.json
RUN python3 -c "import hashlib,json,pathlib; lock=json.load(open('/tmp/source.lock.json')); assert hashlib.sha256(pathlib.Path('/tmp/upstream.tar.gz').read_bytes()).hexdigest()==lock['sha256']" \
    && tar -xzf /tmp/upstream.tar.gz --strip-components=1 -C /build
COPY patch_source.py /tmp/patch_source.py
COPY patch_script_scheduler.py /tmp/patch_script_scheduler.py
ARG FIX_SCRIPT_SCHEDULER=true
RUN python3 /tmp/patch_source.py /build \
    && if [ "$FIX_SCRIPT_SCHEDULER" = "true" ]; then python3 /tmp/patch_script_scheduler.py /build; fi
ENV CARGO_BUILD_JOBS=3
ENV CC=clang CXX=clang++
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/build/target \
    cargo build --locked --release --features render,stealth --bin obscura --bin obscura-worker \
    && mkdir -p /out && cp target/release/obscura target/release/obscura-worker /out/
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/build/target \
    cargo test --locked --release -p obscura-net --features stealth snapflow_filter_tests
FROM h4ckf0r0day/obscura@sha256:475def3ddf1ec513b3d1bc36e8ad15f0d192538cb15f814c77215aa70c418ca2
COPY --from=builder /out/obscura /obscura
COPY --from=builder /out/obscura-worker /obscura-worker
COPY --from=builder /build/LICENSE /usr/share/licenses/obscura/LICENSE
COPY source.lock.json /usr/share/obscura/source.lock.json
