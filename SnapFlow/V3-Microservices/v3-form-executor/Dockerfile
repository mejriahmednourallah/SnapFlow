FROM snapflow/v3-python-heavy-base:latest

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /app

COPY requirements.txt .
RUN pip install --default-timeout=300 --retries=10 --no-cache-dir -r requirements.txt \
    && python -m playwright install chromium

COPY . .

EXPOSE 8085

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8085"]
