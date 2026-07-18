FROM snapflow/v3-python-fastapi-base:latest
WORKDIR /app
COPY requirements.txt .
RUN pip install --default-timeout=300 --retries=10 --no-cache-dir -r requirements.txt \
    && pip install --default-timeout=300 --retries=10 --no-cache-dir --upgrade setuptools==83.0.0 wheel==0.46.2 jaraco.context==6.1.0 \
    && python -c "import pathlib, shutil, site; [shutil.rmtree(p, ignore_errors=True) for b in site.getsitepackages() for n in ('**/wheel-0.45.1.dist-info','**/jaraco.context-5.3.0.dist-info') for p in pathlib.Path(b).glob(n)]"
COPY . .
EXPOSE 8080
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1", "--timeout-keep-alive", "30"]
