from __future__ import annotations

import asyncio
import logging

from executor import FormExecutor, GraphValidationError
from models import ExecutionOutcome
from settings import Settings
from storage import Storage

logger = logging.getLogger("form-executor.worker")


class ExecutionWorker:
    def __init__(self, settings: Settings, storage: Storage, executor: FormExecutor):
        self.settings = settings
        self.storage = storage
        self.executor = executor
        self._stopping = asyncio.Event()
        self.processed = 0
        self.failures = 0

    def stop(self) -> None:
        self._stopping.set()

    async def run(self) -> None:
        logger.info("Form executor worker started")
        while not self._stopping.is_set():
            try:
                cleanup_local_artifacts = getattr(
                    self.storage, "cleanup_local_artifacts", None
                )
                if callable(cleanup_local_artifacts):
                    await asyncio.to_thread(cleanup_local_artifacts)
                await asyncio.to_thread(self.storage.process_control_commands)
                execution = await asyncio.to_thread(self.storage.claim_next_execution)
                if execution is None:
                    try:
                        await asyncio.wait_for(
                            self._stopping.wait(),
                            timeout=self.settings.poll_interval_seconds,
                        )
                    except asyncio.TimeoutError:
                        pass
                    continue

                logger.info("Claimed execution %s", execution.id)
                try:
                    execution_budget_ms = await asyncio.to_thread(
                        self.executor.estimate_execution_budget_ms,
                        execution,
                    )
                    self.executor.set_execution_budget(
                        execution.id, execution_budget_ms
                    )
                    outcome = await asyncio.wait_for(
                        self.executor.execute(execution),
                        timeout=execution_budget_ms / 1000,
                    )
                except asyncio.TimeoutError:
                    timing = self.executor.timeout_context(execution.id)
                    outcome = ExecutionOutcome(
                        status="error",
                        final_url=None,
                        duration_ms=int(
                            timing.get("elapsed_ms") or execution_budget_ms
                        ),
                        failure_reason="execution_timeout",
                        assertions=[],
                        network_summary={},
                        summary={
                            "engine": "chromium",
                            "timeout_ms": execution_budget_ms,
                            "execution_timing": timing,
                            "timeout_phase": timing.get("timeout_phase"),
                            "current_node_id": timing.get("current_node_id"),
                        },
                    )
                except GraphValidationError as exc:
                    outcome = ExecutionOutcome(
                        status="error",
                        final_url=None,
                        duration_ms=0,
                        failure_reason=str(exc),
                        assertions=[],
                        network_summary={},
                        summary={"engine": "chromium", "graph_valid": False},
                    )
                except Exception as exc:
                    logger.exception("Execution crashed: %s", execution.id)
                    outcome = ExecutionOutcome(
                        status="error",
                        final_url=None,
                        duration_ms=0,
                        failure_reason=f"executor_crash:{exc}",
                        assertions=[],
                        network_summary={},
                        summary={"engine": "chromium"},
                    )

                if "business_verdict" not in outcome.summary:
                    outcome.summary.update(
                        {
                            "observed_behavior": "technical_error",
                            "business_verdict": "interrupted",
                            "effective_business_verdict": "interrupted",
                        }
                    )

                await asyncio.to_thread(
                    self.storage.finalize_execution,
                    execution.id,
                    status=outcome.status,
                    duration_ms=outcome.duration_ms,
                    final_url=outcome.final_url,
                    failure_reason=outcome.failure_reason,
                    assertions=outcome.assertions,
                    network_summary=outcome.network_summary,
                    summary=outcome.summary,
                )
                await asyncio.to_thread(
                    self.storage.log,
                    execution.id,
                    "execution_completed",
                    f"Execution terminee avec le statut {outcome.status}.",
                    level=(
                        "error"
                        if outcome.status == "error"
                        else "warning"
                        if outcome.status in {"failed", "blocked", "inconclusive"}
                        else "info"
                    ),
                    details={"failure_reason": outcome.failure_reason, "duration_ms": outcome.duration_ms},
                )
                self.processed += 1
                if outcome.status == "error":
                    self.failures += 1
            except Exception:
                self.failures += 1
                logger.exception("Worker loop failure")
                await asyncio.sleep(self.settings.poll_interval_seconds)
        logger.info("Form executor worker stopped")
