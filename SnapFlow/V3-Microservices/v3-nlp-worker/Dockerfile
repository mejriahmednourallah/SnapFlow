FROM snapflow/v3-python-heavy-base:latest
WORKDIR /app
COPY requirements.txt .
ARG INSTALL_SEMANTIC=false
RUN pip install --default-timeout=300 --retries=10 --no-cache-dir -r requirements.txt \
    && if [ "$INSTALL_SEMANTIC" = "true" ]; then pip install --default-timeout=300 --retries=10 --no-cache-dir sentence-transformers==3.0.1; fi \
    && pip install --default-timeout=300 --retries=10 --no-cache-dir --upgrade setuptools==83.0.0 wheel==0.46.2 jaraco.context==6.1.0 \
    && python -c "import pathlib, shutil, site; [shutil.rmtree(p, ignore_errors=True) for b in site.getsitepackages() for n in ('**/wheel-0.45.1.dist-info','**/jaraco.context-5.3.0.dist-info') for p in pathlib.Path(b).glob(n)]"
COPY . .
CMD ["python", "main.py"]
