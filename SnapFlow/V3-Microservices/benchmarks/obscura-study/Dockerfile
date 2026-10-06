FROM python:3.12-slim-bookworm@sha256:54c85f3c47607a77f32adec749d3c81d1348bf25833671f512b26a9b6d778cb3
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN pip install --no-cache-dir playwright==1.58.0 beautifulsoup4==4.12.3
RUN playwright install --with-deps --only-shell chromium
WORKDIR /study
COPY . .
CMD ["python", "study.py", "--fixtures-only"]
