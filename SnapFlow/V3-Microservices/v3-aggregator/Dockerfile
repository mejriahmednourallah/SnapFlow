FROM snapflow/v3-python-fastapi-base:latest
WORKDIR /app
COPY requirements.txt .
RUN pip install --default-timeout=300 --retries=10 --no-cache-dir -r requirements.txt \
    && pip install --default-timeout=300 --retries=10 --no-cache-dir --upgrade wheel==0.46.2 jaraco.context==6.1.0
COPY . .
EXPOSE 8080
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1", "--timeout-keep-alive", "30"]
