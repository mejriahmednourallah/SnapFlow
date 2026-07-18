FROM snapflow/v3-python-heavy-base:latest

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /app

COPY requirements.txt .
RUN pip install --default-timeout=300 --retries=10 --no-cache-dir -r requirements.txt \
    && pip install --default-timeout=300 --retries=10 --no-cache-dir --upgrade wheel==0.46.2 jaraco.context==6.1.0 \
    && python -c "import pathlib, shutil, site; [shutil.rmtree(p, ignore_errors=True) for b in site.getsitepackages() for n in ('wheel-0.45.1.dist-info','jaraco.context-5.3.0.dist-info') for p in pathlib.Path(b).glob(n)]" \
    && python -m playwright install chromium

COPY . .

EXPOSE 8084

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8084"]
