import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pool


def test_recycling_waits_for_every_context_on_the_selected_worker(monkeypatch):
    monkeypatch.setattr(pool, 'BROWSER_POOL_WORKERS', 1)
    monkeypatch.setattr(pool, 'RECYCLE_AFTER', 2)
    browser_pool = pool.BrowserPool()
    browser_pool._browsers = [object()]
    browser_pool._worker_counters = [0]
    recycled = AsyncMock()
    monkeypatch.setattr(browser_pool, '_recycle_worker', recycled)

    async def run():
        _, first = await browser_pool._pick_browser()
        _, second = await browser_pool._pick_browser()
        browser_pool._release_worker(first)
        _, third = await browser_pool._pick_browser()
        recycled.assert_not_awaited()  # second still owns a context
        browser_pool._release_worker(second)
        browser_pool._release_worker(third)
        _, fourth = await browser_pool._pick_browser()
        recycled.assert_awaited_once_with(0)
        browser_pool._release_worker(fourth)
        assert browser_pool._worker_leases == [0]
    asyncio.run(run())


def test_hung_extraction_timeout_closes_context_and_releases_pool_slot(monkeypatch):
    monkeypatch.setattr(pool, 'BROWSER_POOL_WORKERS', 1)
    browser_pool = pool.BrowserPool()
    browser_pool._started = True
    browser_pool._semaphore = asyncio.Semaphore(1)
    browser_pool._worker_counters = [0]
    page = SimpleNamespace(
        goto=AsyncMock(return_value=None), close=AsyncMock(),
        on=lambda *_: None, content=AsyncMock(), wait_for_timeout=AsyncMock())
    context = SimpleNamespace(new_page=AsyncMock(return_value=page), close=AsyncMock())
    browser_pool._browsers = [SimpleNamespace(new_context=AsyncMock(return_value=context))]

    async def hung():
        await asyncio.Event().wait()
    page.content.side_effect = hung
    original_wait = asyncio.wait_for
    async def controlled_wait(awaitable, timeout):
        if getattr(getattr(awaitable, 'cr_code', None), 'co_name', None) == '_render_once_impl':
            timeout = .03
        return await original_wait(awaitable, timeout)
    monkeypatch.setattr(pool.asyncio, 'wait_for', controlled_wait)

    async def run():
        result = await browser_pool._render_once('https://fixture.test', 1000, 'domcontentloaded', 0, 'chromium', 'desktop')
        assert result.status == pool.PageStatus.TIMEOUT
        assert result.error == 'render_attempt_budget_exhausted'
        page.close.assert_awaited_once()
        context.close.assert_awaited_once()
        assert browser_pool._active_sessions == 0
        assert browser_pool._worker_leases == [0]
        assert await browser_pool._acquire()
        browser_pool._semaphore.release()
    asyncio.run(run())
