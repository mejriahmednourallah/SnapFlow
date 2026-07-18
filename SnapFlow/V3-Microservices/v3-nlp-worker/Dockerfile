FROM snapflow/v3-python-heavy-base:latest
WORKDIR /app
COPY requirements.txt .
ARG INSTALL_SEMANTIC=false
RUN pip install --default-timeout=300 --retries=10 --no-cache-dir -r requirements.txt \
    && if [ "$INSTALL_SEMANTIC" = "true" ]; then pip install --default-timeout=300 --retries=10 --no-cache-dir sentence-transformers==3.0.1; fi \
    && pip install --default-timeout=300 --retries=10 --no-cache-dir --upgrade wheel==0.46.2 jaraco.context==6.1.0
COPY . .
CMD ["python", "main.py"]
