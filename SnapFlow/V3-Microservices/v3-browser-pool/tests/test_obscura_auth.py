import asyncio
import io
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pool


def test_discovery_scope_accepts_explicit_ports_without_admitting_other_hosts():
    for domain in ('preprod-fixture:18991', 'http://preprod-fixture:18991/path'):
        assert pool._host_matches_allowed('preprod-fixture', [domain])
        assert not pool._host_matches_allowed('outside.test', [domain])
    assert pool._normalise_allowed_domains(['[::1]:8080', '::1']) == {'::1'}


def test_authenticated_endpoint_discovery_and_websocket_connect(monkeypatch):
    monkeypatch.setattr(pool, "_OBSCURA_CDP_URL", "http://obscura:9222")
    monkeypatch.setattr(pool, "_OBSCURA_CDP_WS_URL", "")
    monkeypatch.setattr(pool, "_OBSCURA_CDP_TOKEN", "benchmark-token")

    def version_response(request, timeout):
        assert request.get_header("Authorization") == "Bearer benchmark-token"
        return io.BytesIO(json.dumps({"webSocketDebuggerUrl": "ws://127.0.0.1:9222/devtools/browser/test"}).encode())

    monkeypatch.setattr(pool, "urlopen", version_response)

    async def connect():
        browser_pool = pool.BrowserPool()
        browser_pool._started = True
        connect_cdp = AsyncMock()
        browser_pool._playwright = SimpleNamespace(chromium=SimpleNamespace(connect_over_cdp=connect_cdp))
        await browser_pool._get_obscura_browser()
        connect_cdp.assert_awaited_once_with(
            "ws://obscura:9222/devtools/browser/test",
            timeout=pool._OBSCURA_CDP_CONNECT_TIMEOUT_MS,
            headers={"Authorization": "Bearer benchmark-token"},
        )

    asyncio.run(connect())
