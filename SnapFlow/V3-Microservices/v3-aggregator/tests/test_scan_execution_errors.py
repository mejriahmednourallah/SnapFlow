import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import pytest
import main


@pytest.mark.parametrize('url,expected', [
    ('http://preprod-fixture:18991/', ['preprod-fixture', 'www.preprod-fixture']),
    ('https://www.example.com:8443/path', ['example.com', 'www.example.com']),
    ('http://127.0.0.1:8080/', ['127.0.0.1']),
    ('http://[::1]:8080/', ['::1']),
])
def test_scanner_scope_uses_hostname_not_authority(url, expected):
    assert main._scanner_allowed_domains(url) == expected


def test_count_failure_cannot_look_like_no_pending_pages(monkeypatch):
    monkeypatch.setattr(main, 'get_db', lambda: (_ for _ in ()).throw(RuntimeError('database unavailable')))
    with pytest.raises(RuntimeError, match='database unavailable'):
        main.count_pages('fixture')


def test_claimed_job_created_by_other_process_can_advance_state(monkeypatch):
    saved = []
    monkeypatch.setattr(main, 'scans', {})
    monkeypatch.setattr(main, '_load_scan_state_from_db', lambda _id: {'status': 'pending', 'url': 'https://fixture.test'})
    monkeypatch.setattr(main, '_persist_scan_state', lambda _id, state: saved.append(dict(state)))
    main.update_scan_entry('fixture', status=main.ScanStatus.RUNNING)
    assert saved[0]['status'] == main.ScanStatus.RUNNING
    assert saved[0]['url'] == 'https://fixture.test'


def test_failed_kpi_persistence_cannot_be_reported_as_success(monkeypatch):
    monkeypatch.setattr(main, 'get_db', lambda: (_ for _ in ()).throw(RuntimeError('database unavailable')))
    with pytest.raises(RuntimeError, match='database unavailable'):
        main._persist_kpi_payload('fixture', {})


def test_read_timeout_does_not_launch_same_scan_on_another_endpoint(monkeypatch):
    from concurrent.futures import Future
    calls, updates = [], []
    class Executor:
        def __init__(self, **_kwargs): pass
        def submit(self, *_args):
            future = Future()
            future.set_result({})
            return future
        def shutdown(self, **_kwargs): pass
    def request(url, **kwargs):
        calls.append((url, kwargs['timeout']))
        raise main.requests.exceptions.ReadTimeout('scanner already accepted request')
    monkeypatch.setattr(main, 'ThreadPoolExecutor', Executor)
    monkeypatch.setattr(main, '_scanner_base_candidates', lambda: ['http://first', 'http://second'])
    monkeypatch.setattr(main.requests, 'post', request)
    monkeypatch.setattr(main, 'update_scan_entry', lambda _id, **state: updates.append(state))
    main.run_scanner('fixture', 'https://fixture.test', 500, 8)
    assert calls == [('http://first/scan', main.SCANNER_HTTP_TIMEOUT_SEC)]
    assert updates[-1]['status'] == main.ScanStatus.FAILED
