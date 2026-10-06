ARG BROWSER_RUNTIME_IMAGE=snapflow/v3-browser-pool:broader-study
FROM ${BROWSER_RUNTIME_IMAGE}
WORKDIR /app
COPY . .
