import sys
from pathlib import Path
from types import ModuleType

import pytest

pytest.importorskip("bs4")
pytest.importorskip("nltk")
pytest.importorskip("textstat")

psycopg2_stub = ModuleType("psycopg2")
psycopg2_extras_stub = ModuleType("psycopg2.extras")
psycopg2_extras_stub.RealDictCursor = object
psycopg2_stub.extras = psycopg2_extras_stub
sys.modules.setdefault("psycopg2", psycopg2_stub)
sys.modules.setdefault("psycopg2.extras", psycopg2_extras_stub)

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bs4 import BeautifulSoup

from main import detect_schema_org


def test_detect_schema_org_accepts_valid_json_ld_type():
    soup = BeautifulSoup(
        """
        <html><head>
          <script type="application/ld+json">
            {"@context":"https://schema.org","@type":"Organization","name":"Example"}
          </script>
        </head><body></body></html>
        """,
        "html.parser",
    )

    result = detect_schema_org(soup)

    assert result["json_ld_present"] is True
    assert result["json_ld_valid"] is True
    assert result["schema_org_present"] is True
    assert result["json_ld_types"] == ["Organization"]
    assert result["json_ld_parse_errors"] == 0


def test_detect_schema_org_rejects_invalid_json_ld():
    soup = BeautifulSoup(
        """
        <script type="application/ld+json">
          {"@context":"https://schema.org","@type":
        </script>
        """,
        "html.parser",
    )

    result = detect_schema_org(soup)

    assert result["json_ld_present"] is True
    assert result["json_ld_valid"] is False
    assert result["schema_org_present"] is False
    assert result["json_ld_types"] == []
    assert result["json_ld_parse_errors"] == 1


def test_detect_schema_org_microdata_alone_is_not_json_ld_valid():
    soup = BeautifulSoup(
        """
        <div itemscope itemtype="https://schema.org/Organization">
          <span itemprop="name">Example</span>
        </div>
        """,
        "html.parser",
    )

    result = detect_schema_org(soup)

    assert result["json_ld_present"] is False
    assert result["json_ld_valid"] is False
    assert result["schema_org_present"] is False
    assert result["json_ld_types"] == []
