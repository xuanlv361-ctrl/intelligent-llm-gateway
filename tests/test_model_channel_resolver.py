import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from model_channel_resolver import (  # noqa: E402
    ModelChannelResolutionError,
    load_mapping,
    resolve_model_channels,
)
from model_selection_pipeline import build_demo, select_for_request  # noqa: E402

AS_OF = datetime(2026, 10, 19, tzinfo=timezone.utc)


def test_every_catalog_model_has_documented_real_candidates():
    mapping = load_mapping()
    assert len(mapping["models"]) == 6
    for model_id in mapping["models"]:
        rows = resolve_model_channels(model_id, mapping, now=AS_OF)
        assert rows
        assert all(row["is_mock"] is False and row["execution_enabled"] is False for row in rows)
        assert all(row["source_urls"] and row["provider_model_id"] for row in rows)
        assert rows == sorted(rows, key=lambda row: (row["priority"], row["channel_id"]))


def test_unknown_model_rejected():
    with pytest.raises(ModelChannelResolutionError, match="unknown"):
        resolve_model_channels("missing-model")


def test_end_to_end_pipeline_is_deterministic_and_offline():
    first = select_for_request("REQ-1", "Write Python code", requested_model="deepseek-flash", now=AS_OF)
    assert first == select_for_request("REQ-1", "Write Python code", requested_model="deepseek-flash", now=AS_OF)
    assert first["selected_model"]
    assert first["channel_candidates"]
    assert first["final_channel_decision"] == first["channel_candidates"][0]["channel_id"]
    assert first["real_api_called"] is False
    assert first["source_type"] == "provider_documented_selection"
    assert first["selected_model"] == "deepseek-v4.1-flash-1017"
    assert len(first["channel_candidates"]) == 3


def test_combined_gpt_alias_requires_an_explicit_model():
    with pytest.raises(ModelChannelResolutionError, match="ambiguous"):
        resolve_model_channels("gpt-4o-4-1", now=AS_OF)
    result = select_for_request("REQ-AMBIGUOUS", "Write Python code",
                                requested_model="gpt-4o-4-1", now=AS_OF)
    assert result["final_channel_decision"] is None
    assert result["channel_resolution_status"] == "model_selection_required"


def test_stale_and_retired_channels_are_not_resolved():
    assert resolve_model_channels("deepseek-flash", now=datetime(2026, 11, 1, tzinfo=timezone.utc)) == []
    assert resolve_model_channels("gpt-4.1", now=datetime(2027, 1, 14, tzinfo=timezone.utc)) == []


def test_explicit_model_choice_is_part_of_decision_identity():
    first = select_for_request("REQ-CHOICE", "Hello", requested_model="gpt-4.1", now=AS_OF)
    second = select_for_request("REQ-CHOICE", "Hello", requested_model="gpt-4o", now=AS_OF)
    assert first["decision_id"] != second["decision_id"]
    assert first["selected_model"] == "gpt-4.1-2025-04-14"
    assert second["selected_model"] == "gpt-4o-2024-11-20"


def test_demo_log_rows_have_complete_dashboard_fields():
    rows = build_demo()
    assert len(rows) == 3
    required = {
        "user_request", "detected_task", "model_ranking", "selected_model",
        "channel_candidates", "final_channel_decision",
    }
    assert all(required <= row.keys() for row in rows)
