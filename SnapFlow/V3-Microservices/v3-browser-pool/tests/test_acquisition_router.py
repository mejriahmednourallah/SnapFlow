import asyncio
from types import SimpleNamespace

from acquisition_router import AcquisitionRouter


def test_api_preserves_routing_budget_marker_and_attempts(monkeypatch):
    import main
    import pool
    from unittest.mock import AsyncMock

    acquired = pool.DiscoveryResult(
        status=pool.PageStatus.TIMEOUT, url='https://fixture.test/',
        acquisition_routed=True, acquisition_attempts=[],
        error='acquisition_budget_exhausted')
    fetch = AsyncMock(return_value=acquired)
    monkeypatch.setattr(main, '_pool', SimpleNamespace(discover_rendered=fetch))
    response = asyncio.run(main.discover_rendered(main.DiscoverRenderedRequest(
        url='https://fixture.test/', scan_id='scan-pilot', capture_projection=True)))
    assert response['acquisition_routed'] is True
    assert response['acquisition_attempts'] == []
    assert fetch.call_args.kwargs['scan_id'] == 'scan-pilot'
    assert fetch.call_args.kwargs['capture_projection'] is True


def test_pool_marks_routed_queue_timeout_and_passes_scan_scope(monkeypatch):
    import pool
    from unittest.mock import AsyncMock

    monkeypatch.setattr(pool, '_OBSCURA_ACQUISITION_ROUTER_ENABLED', True)
    browser_pool = pool.BrowserPool()
    monkeypatch.setattr(browser_pool, '_obscura_available_for', lambda feature: True)
    routed = AsyncMock(return_value=(None, []))
    browser_pool._acquisition_router = SimpleNamespace(acquire=routed)

    acquired = asyncio.run(browser_pool.discover_rendered(
        'https://fixture.test/', scan_id='scan-pilot', wait_ms=20000))
    assert acquired.acquisition_routed
    assert acquired.acquisition_attempts == []
    assert acquired.error == 'acquisition_budget_exhausted'
    assert routed.call_args.args[:3] == ('scan-pilot', 'https://fixture.test/', 20000)


def test_measurements_bypass_content_router_even_when_enabled(monkeypatch):
    import pool
    from unittest.mock import AsyncMock

    monkeypatch.setattr(pool, '_OBSCURA_ACQUISITION_ROUTER_ENABLED', True)
    browser_pool = pool.BrowserPool()
    direct = AsyncMock(return_value=pool.DiscoveryResult(status=pool.PageStatus.SUCCESS, url='https://fixture.test/'))
    monkeypatch.setattr(browser_pool, '_discover_rendered_once', direct)
    routed = AsyncMock()
    browser_pool._acquisition_router = SimpleNamespace(acquire=routed)
    asyncio.run(browser_pool.discover_rendered(
        'https://fixture.test/', scan_id='scan-pilot', measure_metrics=True))
    assert direct.call_args.kwargs['force_chromium'] is True
    assert direct.call_args.kwargs['measure_metrics'] is True
    routed.assert_not_awaited()


def result(engine, success=False, error='navigation_timeout'):
    return SimpleNamespace(status='success' if success else 'timeout', engine=engine,
                           error=None if success else error, final_url='https://fixture.test/page',
                           rendered_html='<main>Useful evidence</main>' if success else None,
                           visible_text='Useful evidence' if success else None, navigation_status=200)


def test_recovery_preserves_attempts_and_origin_history_counts_distinct_pages():
    async def run():
        router = AcquisitionRouter()
        calls = []
        async def fetch(engine, budget):
            calls.append((engine,budget))
            return result(engine, engine == 'chromium')
        for number in range(3):
            acquired, attempts = await router.acquire('scan-a', f'https://fixture.test/{number}', 30000, fetch)
            assert acquired.engine == 'chromium'
            assert [a['engine'] for a in attempts] == ['obscura','obscura','chromium']
            assert attempts[-1]['rendered_html'] == '<main>Useful evidence</main>'
        _acquired, attempts = await router.acquire('scan-a','https://fixture.test/4',30000,fetch)
        assert [a['engine'] for a in attempts] == ['chromium']
        _acquired, attempts = await router.acquire('scan-b','https://fixture.test/4',30000,fetch)
        assert [a['engine'] for a in attempts] == ['obscura','obscura','chromium']
    asyncio.run(run())


def test_transient_failure_recovers_in_fresh_obscura_attempt():
    async def run():
        router = AcquisitionRouter()
        calls = []
        async def fetch(engine,budget):
            calls.append(engine)
            return result(engine,len(calls)>1)
        acquired, attempts = await router.acquire('scan','https://fixture.test/',10000,fetch)
        assert acquired.engine == 'obscura'
        assert len(attempts) == 2
        assert router.state('scan','https://fixture.test/')['outcomes'][0][1]
    asyncio.run(run())


def test_deterministic_unsupported_operation_does_not_repeat():
    async def run():
        async def fetch(engine,budget):
            return result(engine,engine == 'chromium',error='CDP operation not supported')
        acquired, attempts = await AcquisitionRouter().acquire('scan','https://fixture.test/',10000,fetch)
        assert acquired.engine == 'chromium'
        assert [a['engine'] for a in attempts] == ['obscura','chromium']
    asyncio.run(run())


def test_empty_success_is_reacquired_and_observations_retained():
    async def run():
        async def fetch(engine,budget):
            page = result(engine,True)
            if engine == 'obscura':
                page.visible_text = ''
            return page
        acquired, attempts = await AcquisitionRouter().acquire('scan','https://fixture.test/',10000,fetch)
        assert acquired.engine == 'chromium'
        assert attempts[0]['rendered_html']
    asyncio.run(run())
