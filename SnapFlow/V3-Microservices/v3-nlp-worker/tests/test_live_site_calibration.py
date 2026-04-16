import os

import pytest

from live_site_calibration import run_profile


@pytest.mark.skipif(os.getenv("NLP_LIVE_TEST", "0") != "1", reason="Set NLP_LIVE_TEST=1 to run live-site calibration")
def test_biat_live_profile_passes():
    report = run_profile("biat", timeout=30)
    assert report["pages_tested"] >= 3
    assert report["failed_checks"] == 0, report
