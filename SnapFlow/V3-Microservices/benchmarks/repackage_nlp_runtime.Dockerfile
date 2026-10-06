# Study-only source refresh over a previously validated dependency image.
# Production remains built by v3-nlp-worker/Dockerfile with INSTALL_SEMANTIC.
ARG NLP_RUNTIME_IMAGE=snapflow/v3-nlp-worker:semantic-study
FROM ${NLP_RUNTIME_IMAGE}
WORKDIR /app
COPY . .
CMD ["python", "main.py"]
