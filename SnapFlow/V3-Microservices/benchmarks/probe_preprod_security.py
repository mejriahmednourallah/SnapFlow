"""Judge one final KPI against the owned target's known absent admin routes."""
import json
from pathlib import Path

root = Path(__file__).resolve().parents[2]
folder = root / 'output/capacity-study'
audit = json.loads((folder / 'preprod-audit.json').read_text(encoding='utf-8'))
checks = []
for scan in (audit['first_scan'], audit['second_scan']):
    report = json.loads((folder / f'preprod-{scan}-report.json').read_text(encoding='utf-8'))
    kpi = next(kpi for axis in report['axes'].values() for kpi in axis.values()
        if isinstance(kpi,dict) and kpi.get('kpi_id') == 'sec_admin_exposed')
    data = kpi['data']
    assert kpi['status'] == 'passing' and kpi['severity'] is None, kpi
    assert not data.get('exposed') and not data.get('server_errors'), data
    codes = data['status_codes']
    assert len(codes) >= 20 and set(codes.values()) == {404}, codes
    checks.append(dict(scan_id=scan,expected='No exposed admin routes: GET returns 404 even though HEAD is unsupported.',
        status=kpi['status'],severity=kpi['severity'],get_confirmed_absent_routes=len(codes)))
artifact = dict(assertions='passed',checks=checks,
    scope='Independent final admin-exposure verdict on a controlled HEAD-unsupported site; does not validate all security or content KPIs.')
(folder / 'preprod-security.json').write_text(json.dumps(artifact,indent=2),encoding='utf-8')
print(json.dumps(artifact))
