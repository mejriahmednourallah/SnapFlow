from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from playwright.async_api import async_playwright

from executor import FormExecutor
from settings import Settings
from storage import Storage
from worker import ExecutionWorker

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("form-executor")

settings = Settings.from_env()
storage: Storage | None = None
workers: list[ExecutionWorker] = []
worker_tasks: list[asyncio.Task] = []
playwright = None
browser = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global workers, worker_tasks, playwright, browser, storage
    storage = Storage(settings)
    playwright = await async_playwright().start()
    launch_args = ["--disable-dev-shm-usage"]
    if settings.chrome_no_sandbox:
        launch_args.extend(["--no-sandbox", "--disable-gpu"])
    browser = await playwright.chromium.launch(headless=settings.headless, args=launch_args)
    executor = FormExecutor(settings, storage, browser)
    workers = [
        ExecutionWorker(settings, storage, executor)
        for _ in range(settings.concurrency)
    ]
    worker_tasks = [asyncio.create_task(worker.run()) for worker in workers]
    logger.info("v3-form-executor ready workers=%s", len(workers))
    yield
    for worker in workers:
        worker.stop()
    if worker_tasks:
        await asyncio.gather(*worker_tasks)
    if browser:
        await browser.close()
    if playwright:
        await playwright.stop()
    storage.close()
    storage = None
    workers = []
    worker_tasks = []


app = FastAPI(title="v3-form-executor", version="1.0.0", lifespan=lifespan)


@app.get("/health")
async def health():
    database_ok = bool(storage and await asyncio.to_thread(storage.health))
    running_workers = sum(1 for task in worker_tasks if not task.done())
    return {
        "status": "ok" if database_ok and running_workers == settings.concurrency else "degraded",
        "database": database_ok,
        "worker_running": running_workers > 0,
        "worker_count": running_workers,
        "configured_concurrency": settings.concurrency,
        "processed": sum(worker.processed for worker in workers),
        "failures": sum(worker.failures for worker in workers),
    }
