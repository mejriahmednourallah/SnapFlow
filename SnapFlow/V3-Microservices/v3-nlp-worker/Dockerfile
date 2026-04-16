FROM snapflow/v3-python-heavy-base:latest
WORKDIR /app
COPY requirements.txt .
RUN pip install --default-timeout=300 --retries=10 --no-cache-dir -r requirements.txt
COPY . .
CMD ["python", "main.py"]
