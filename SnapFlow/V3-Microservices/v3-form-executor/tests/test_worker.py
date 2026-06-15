from __future__ import annotations

import asyncio
import threading

from tests.helpers import execution, settings
from worker import ExecutionWorker


class WorkerStorage:
    def __init__(self):
        self.execution = execution()
        self.finalized = threading.Event()
        self.final_result = None
        self.logs = []

    def process_control_commands(self):
        return 0

    def claim_next_execution(self):
        claimed = self.execution
        self.execution = None
        return claimed

    def finalize_execution(self, execution_id, **result):
        self.final_result = {"execution_id": execution_id, **result}
        self.finalized.set()

    def log(self, execution_id, event_type, message, **details):
        self.logs.append((execution_id, event_type, message, details))


class CrashingExecutor:
    async def execute(self, execution_record):
        raise RuntimeError("browser_process_crashed")


def test_worker_converts_executor_crash_to_error(tmp_path):
    async def verify():
        storage = WorkerStorage()
        worker = ExecutionWorker(settings(tmp_path), storage, CrashingExecutor())
        task = asyncio.create_task(worker.run())
        completed = await asyncio.wait_for(asyncio.to_thread(storage.finalized.wait, 3), timeout=4)
        assert completed
        worker.stop()
        await asyncio.wait_for(task, timeout=3)

        assert storage.final_result["status"] == "error"
        assert storage.final_result["failure_reason"].startswith("executor_crash:")
        assert storage.final_result["summary"]["engine"] == "chromium"
        assert worker.failures == 1

    asyncio.run(verify())
