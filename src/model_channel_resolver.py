"""Resolve documented provider offers without enabling provider execution."""

from __future__ import annotations

import json
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Mapping

from model_market_catalog import ModelMarketCatalogError, resolve_model_id


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MAPPING_PATH = ROOT / "data" / "model_channel_mapping_v1.json"


class ModelChannelResolutionError(ValueError):
    pass


def load_mapping(path: Path = DEFAULT_MAPPING_PATH) -> dict[str, Any]:
    with Path(path).open(encoding="utf-8-sig") as handle:
        return json.load(handle)


def resolve_model_channels(
    selected_model: str,
    mapping: Mapping[str, Any] | None = None,
    *,
    now: datetime | None = None,
) -> list[dict[str, Any]]:
    mapping = load_mapping() if mapping is None else mapping
    try:
        canonical = resolve_model_id(selected_model, mapping)
    except ModelMarketCatalogError as exc:
        raise ModelChannelResolutionError(str(exc)) from exc
    now = datetime.now(timezone.utc) if now is None else now
    if now.tzinfo is None:
        raise ModelChannelResolutionError("now must be timezone-aware")
    max_age = timedelta(days=int(mapping["freshness_max_age_days"]))
    rows = []
    for configured in mapping["models"][canonical]:
        if configured.get("is_mock") is not False or configured.get("execution_enabled") is not False:
            raise ModelChannelResolutionError("documented offer cannot enable execution or contain Mock data")
        if (configured.get("availability_status") != "documented"
                or configured.get("verification_status") != "provider_documented"):
            continue
        stamps = [datetime.fromisoformat(value.replace("Z", "+00:00")) for value in
                  (mapping["verified_at"], configured["verified_at"])]
        if any(stamp.tzinfo is None for stamp in stamps):
            raise ModelChannelResolutionError("verification timestamp must be timezone-aware")
        if any(stamp > now or now - stamp > max_age for stamp in stamps):
            continue
        sunset = configured.get("sunset_at")
        if sunset and now >= datetime.fromisoformat(sunset.replace("Z", "+00:00")):
            continue
        rows.append({**deepcopy(configured), "market_model_id": canonical})
    rows.sort(key=lambda row: (int(row["priority"]), str(row["channel_id"])))
    return rows
