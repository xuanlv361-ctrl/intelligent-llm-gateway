"""Compare documented model offers without performing provider requests.

Prices are published list prices, not a guarantee of account access or a live
quote. Reliability remains unknown until observations have actually been made.
"""

from __future__ import annotations

import argparse
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation, localcontext
import json
from pathlib import Path
from typing import Any, Mapping


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MAPPING_PATH = ROOT / "data" / "model_channel_mapping_v1.json"
DEFAULT_COST_PATH = ROOT / "data" / "model_cost_catalog_v1.json"
PRICE_UNIT = "currency_per_1m_tokens"


class ModelMarketCatalogError(ValueError):
    """The catalog or requested comparison cannot be interpreted safely."""


def _timestamp(value: Any, field: str) -> datetime:
    if not isinstance(value, str):
        raise ModelMarketCatalogError(f"{field} must be an ISO UTC timestamp")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ModelMarketCatalogError(f"{field} must be an ISO UTC timestamp") from exc
    if parsed.tzinfo is None or parsed.utcoffset() != timedelta(0):
        raise ModelMarketCatalogError(f"{field} must use UTC")
    return parsed


def _price(value: Any, field: str, *, optional: bool = False) -> Decimal | None:
    if value is None and optional:
        return None
    try:
        if isinstance(value, bool):
            raise InvalidOperation
        number = Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise ModelMarketCatalogError(f"{field} must be a finite non-negative price") from exc
    if not number.is_finite() or number < 0:
        raise ModelMarketCatalogError(f"{field} must be a finite non-negative price")
    return number


def _integer(value: Any, field: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ModelMarketCatalogError(f"{field} must be a non-negative integer")
    return value


def _sources(value: Any, field: str) -> None:
    if not isinstance(value, list) or not value:
        raise ModelMarketCatalogError(f"{field} must contain source URLs")
    if any(not isinstance(url, str) or not url.startswith("https://") for url in value):
        raise ModelMarketCatalogError(f"{field} must contain HTTPS source URLs")


def _load(path: Path) -> dict[str, Any]:
    with Path(path).open(encoding="utf-8-sig") as handle:
        loaded = json.load(handle, parse_float=Decimal)
    if not isinstance(loaded, dict):
        raise ModelMarketCatalogError("catalog must be a JSON object")
    return loaded


def load_mapping(path: Path = DEFAULT_MAPPING_PATH) -> dict[str, Any]:
    return _load(path)


def load_cost_catalog(path: Path = DEFAULT_COST_PATH) -> dict[str, Any]:
    return _load(path)


def resolve_model_id(model_id: str, mapping: Mapping[str, Any]) -> str:
    """Resolve only explicitly configured aliases; never merge model versions."""
    if model_id in mapping.get("ambiguous_model_aliases", {}):
        alternatives = ", ".join(mapping["ambiguous_model_aliases"][model_id])
        raise ModelMarketCatalogError(f"ambiguous model_id: {model_id}; choose {alternatives}")
    canonical = mapping.get("model_aliases", {}).get(model_id, model_id)
    if canonical not in mapping.get("models", {}):
        raise ModelMarketCatalogError(f"unknown model_id: {model_id}")
    return canonical


def validate_market_catalog(mapping: Mapping[str, Any], cost_catalog: Mapping[str, Any]) -> None:
    """Validate identity joins and price semantics before calculating any quote."""
    _timestamp(mapping.get("verified_at"), "mapping.verified_at")
    _timestamp(cost_catalog.get("verified_at"), "cost_catalog.verified_at")
    days = _integer(mapping.get("freshness_max_age_days"), "freshness_max_age_days")
    if days == 0:
        raise ModelMarketCatalogError("freshness_max_age_days must be positive")
    cost_days = _integer(cost_catalog.get("freshness_max_age_days", days), "cost.freshness_max_age_days")
    if cost_days == 0:
        raise ModelMarketCatalogError("cost.freshness_max_age_days must be positive")
    if cost_catalog.get("price_unit") != PRICE_UNIT:
        raise ModelMarketCatalogError(f"price_unit must be {PRICE_UNIT}")
    models = mapping.get("models")
    if not isinstance(models, Mapping) or not models:
        raise ModelMarketCatalogError("mapping.models must not be empty")
    offers: dict[str, tuple[str, Mapping[str, Any]]] = {}
    candidate_ids: set[str] = set()
    for model_id, model_offers in models.items():
        if not isinstance(model_id, str) or not model_id or not isinstance(model_offers, list):
            raise ModelMarketCatalogError("invalid model identity or offers")
        for offer in model_offers:
            required = {
                "candidate_id", "channel_id", "provider", "provider_model_id", "api_base",
                "api_path", "api_format", "priority", "is_mock", "availability_status",
                "verification_status", "source_urls", "verified_at", "execution_enabled", "health",
            }
            if not isinstance(offer, Mapping) or required - offer.keys():
                raise ModelMarketCatalogError(f"incomplete offer for {model_id}")
            channel = offer["channel_id"]
            if not isinstance(channel, str) or not channel or channel in offers:
                raise ModelMarketCatalogError("channel_id must be non-empty and unique")
            if offer["candidate_id"] in candidate_ids:
                raise ModelMarketCatalogError("candidate_id must be unique")
            candidate_ids.add(offer["candidate_id"])
            if offer["is_mock"] is not False or offer["execution_enabled"] is not False:
                raise ModelMarketCatalogError("documented offers must be real and execution disabled")
            if not all(isinstance(offer[key], str) and offer[key] for key in (
                "candidate_id", "provider", "provider_model_id", "api_path", "api_format",
            )) or not str(offer["api_base"]).startswith("https://"):
                raise ModelMarketCatalogError("offer identity and HTTPS endpoint are required")
            _integer(offer["priority"], "offer.priority")
            _sources(offer["source_urls"], "offer.source_urls")
            _timestamp(offer["verified_at"], "offer.verified_at")
            if offer.get("sunset_at") is not None:
                _timestamp(offer["sunset_at"], "offer.sunset_at")
            if offer.get("model_id_kind") == "rolling_alias" and not (
                isinstance(offer.get("resolved_version_at_verification"), str)
                and offer["resolved_version_at_verification"].strip()
            ):
                raise ModelMarketCatalogError("rolling alias must identify its version at verification")
            health = offer["health"]
            if not isinstance(health, Mapping):
                raise ModelMarketCatalogError("offer.health must be an object")
            count = _integer(health.get("sample_count"), "health.sample_count")
            if count == 0 and any(health.get(key) is not None for key in (
                "success_rate", "p95_latency_ms", "ttft_ms",
            )):
                raise ModelMarketCatalogError("unmeasured health metrics must be null")
            if count == 0 and health.get("status") != "unmeasured":
                raise ModelMarketCatalogError("zero-sample health must be unmeasured")
            if health.get("success_rate") is not None:
                rate = _price(health["success_rate"], "health.success_rate")
                if rate > 1:
                    raise ModelMarketCatalogError("health.success_rate must be between 0 and 1")
            for key in ("p95_latency_ms", "ttft_ms"):
                _price(health.get(key), f"health.{key}", optional=True)
            offers[channel] = (model_id, offer)
    for alias, canonical in mapping.get("model_aliases", {}).items():
        if not alias or canonical not in models or (alias in models and alias != canonical):
            raise ModelMarketCatalogError("model alias must resolve to one canonical model")
    for alias, alternatives in mapping.get("ambiguous_model_aliases", {}).items():
        if alias in models or alias in mapping.get("model_aliases", {}) or not isinstance(alternatives, list):
            raise ModelMarketCatalogError("ambiguous alias cannot also resolve to a model")
        if len(set(alternatives)) < 2 or any(item not in models for item in alternatives):
            raise ModelMarketCatalogError("ambiguous alias must list existing model alternatives")
    seen_prices: set[str] = set()
    for row in cost_catalog.get("channel_prices", []):
        channel = row.get("channel_id")
        if channel not in offers or channel in seen_prices:
            raise ModelMarketCatalogError("channel price must join one unique documented offer")
        model_id, offer = offers[channel]
        if row.get("model_id") != model_id or row.get("provider_model_id") != offer["provider_model_id"]:
            raise ModelMarketCatalogError("price model identity does not match its offer")
        if row.get("price_unit") != PRICE_UNIT or not isinstance(row.get("currency"), str) or not row["currency"]:
            raise ModelMarketCatalogError("price currency and per-million-token unit are required")
        _sources(row.get("source_urls"), "price.source_urls")
        _timestamp(row.get("verified_at"), "price.verified_at")
        for key in ("input_price", "output_price", "cached_input_price"):
            _price(row.get(key), f"price.{key}", optional=key == "cached_input_price")
        tiers = row.get("pricing_tiers", [])
        if not isinstance(tiers, list):
            raise ModelMarketCatalogError("pricing_tiers must be a list")
        tier_ids: set[str] = set()
        for tier in tiers:
            tier_id = tier.get("tier_id")
            if not isinstance(tier_id, str) or not tier_id or tier_id in tier_ids:
                raise ModelMarketCatalogError("tier_id must be non-empty and unique within an offer")
            tier_ids.add(tier_id)
            low = _integer(tier.get("input_tokens_min"), "tier.input_tokens_min")
            high = tier.get("input_tokens_max")
            if high is not None and _integer(high, "tier.input_tokens_max") < low:
                raise ModelMarketCatalogError("tier token bounds are inverted")
            starts, ends = tier.get("valid_from"), tier.get("valid_until")
            if starts is not None:
                _timestamp(starts, "tier.valid_from")
            if ends is not None:
                _timestamp(ends, "tier.valid_until")
            if starts is not None and ends is not None and _timestamp(starts, "tier.valid_from") >= _timestamp(ends, "tier.valid_until"):
                raise ModelMarketCatalogError("tier time bounds are inverted")
            for key in ("input_price", "output_price", "cached_input_price"):
                _price(tier.get(key), f"tier.{key}", optional=key == "cached_input_price")
        seen_prices.add(channel)
    seen_models: set[str] = set()
    channel_prices = {row["channel_id"]: row for row in cost_catalog.get("channel_prices", [])}
    for row in cost_catalog.get("models", []):
        model = row.get("model_id")
        channel = row.get("reference_channel_id")
        if model not in models or model in seen_models or channel not in offers or offers[channel][0] != model:
            raise ModelMarketCatalogError("model reference price must join its canonical model and channel")
        if channel not in seen_prices:
            raise ModelMarketCatalogError("model reference channel must have documented pricing")
        for key in ("input_price", "output_price", "cached_input_price"):
            reference_value = _price(row.get(key), f"model.{key}", optional=key == "cached_input_price")
            channel_value = _price(channel_prices[channel].get(key), f"price.{key}", optional=key == "cached_input_price")
            if reference_value != channel_value:
                raise ModelMarketCatalogError("model reference price does not match its channel price")
        if row.get("currency") != channel_prices[channel]["currency"]:
            raise ModelMarketCatalogError("model reference currency does not match its channel currency")
        if row.get("latency_level") is not None:
            raise ModelMarketCatalogError("unobserved latency_level must be null")
        _timestamp(row.get("verified_at"), "model.verified_at")
        _sources([row.get("price_source_url")], "model.price_source_url")
        if row["price_source_url"] not in channel_prices[channel]["source_urls"]:
            raise ModelMarketCatalogError("model reference price source must belong to its channel price")
        seen_models.add(model)


def _freshness(timestamps: list[str], now: datetime, max_age_days: int) -> str | None:
    verified = [_timestamp(value, "verified_at") for value in timestamps]
    if any(value > now for value in verified):
        return "not_yet_verified"
    if any(now - value > timedelta(days=max_age_days) for value in verified):
        return "stale"
    return None


def _matching_tiers(row: Mapping[str, Any], input_tokens: int, now: datetime) -> list[Mapping[str, Any]]:
    return [tier for tier in row.get("pricing_tiers", []) if (
        tier["input_tokens_min"] <= input_tokens
        and (tier.get("input_tokens_max") is None or input_tokens <= tier["input_tokens_max"])
        and (tier.get("valid_from") is None or now >= _timestamp(tier["valid_from"], "valid_from"))
        and (tier.get("valid_until") is None or now < _timestamp(tier["valid_until"], "valid_until"))
    )]


def _json_safe(value: Any) -> Any:
    if isinstance(value, Decimal):
        return format(value, "f")
    if isinstance(value, Mapping):
        return {key: _json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_json_safe(item) for item in value]
    return value


def compare_model_channels(
    model_id: str,
    input_tokens: int = 1000,
    output_tokens: int = 500,
    cached_input_tokens: int = 0,
    *,
    now: datetime | None = None,
    mapping: Mapping[str, Any] | None = None,
    cost_catalog: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Return documented offers and exact estimates, retaining unknown health.

    ``input_tokens`` includes ``cached_input_tokens``. Estimates exclude taxes,
    currency conversion, tool charges, and provider-specific non-token charges.
    The input token count, rather than requested output length, chooses a tier.
    """
    mapping = load_mapping() if mapping is None else mapping
    cost_catalog = load_cost_catalog() if cost_catalog is None else cost_catalog
    validate_market_catalog(mapping, cost_catalog)
    canonical = resolve_model_id(model_id, mapping)
    for value, field in ((input_tokens, "input_tokens"), (output_tokens, "output_tokens"), (cached_input_tokens, "cached_input_tokens")):
        _integer(value, field)
    if cached_input_tokens > input_tokens:
        raise ModelMarketCatalogError("cached_input_tokens cannot exceed input_tokens")
    now = datetime.now(timezone.utc) if now is None else now
    if not isinstance(now, datetime) or now.tzinfo is None:
        raise ModelMarketCatalogError("now must be a timezone-aware datetime")
    now = now.astimezone(timezone.utc)
    prices = {row["channel_id"]: row for row in cost_catalog.get("channel_prices", [])}
    max_age = min(mapping["freshness_max_age_days"], cost_catalog.get(
        "freshness_max_age_days", mapping["freshness_max_age_days"],
    ))
    output = []
    for configured in sorted(mapping["models"][canonical], key=lambda item: (item["priority"], item["channel_id"])):
        offer = deepcopy(dict(configured))
        offer.update({
            "model_id": canonical, "execution_enabled": False, "price_unit": PRICE_UNIT,
            "currency": None, "estimated_cost": None, "applicable_tier": None,
            "price_breakdown": None, "quote_status": "missing_price",
        })
        row = prices.get(offer["channel_id"])
        if row is not None:
            offer["currency"] = row["currency"]
            offer["source_urls"] = list(dict.fromkeys(offer["source_urls"] + row["source_urls"]))
            offer["pricing_verified_at"] = row["verified_at"]
            offer["pricing_notes"] = deepcopy(row.get("notes", []))
        sunset = offer.get("sunset_at")
        status = None
        if sunset is not None and now >= _timestamp(sunset, "sunset_at"):
            status = "retired"
        elif offer["availability_status"] != "documented":
            status = "unavailable"
        elif offer["verification_status"] != "provider_documented":
            status = "unverified"
        else:
            stamps = [mapping["verified_at"], cost_catalog["verified_at"], offer["verified_at"]]
            if row is not None:
                stamps.append(row["verified_at"])
            status = _freshness(stamps, now, max_age)
        if status:
            offer["quote_status"] = status
        elif row is not None:
            tiers = _matching_tiers(row, input_tokens, now)
            if row.get("pricing_tiers") and len(tiers) != 1:
                offer["quote_status"] = "no_applicable_price_tier" if not tiers else "ambiguous_price_tier"
            else:
                applicable = tiers[0] if tiers else row
                offer["applicable_tier"] = deepcopy(dict(tiers[0])) if tiers else {"tier_id": "standard"}
                cached_price = _price(applicable.get("cached_input_price"), "cached_input_price", optional=True)
                if cached_input_tokens and cached_price is None:
                    offer["quote_status"] = "unknown_cached_price"
                else:
                    with localcontext() as context:
                        context.prec = 50
                        normal_cost = Decimal(input_tokens - cached_input_tokens) * _price(applicable["input_price"], "input_price") / Decimal(1000000)
                        cached_cost = Decimal(cached_input_tokens) * (cached_price or Decimal(0)) / Decimal(1000000)
                        output_cost = Decimal(output_tokens) * _price(applicable["output_price"], "output_price") / Decimal(1000000)
                        offer["estimated_cost"] = format(normal_cost + cached_cost + output_cost, "f")
                    offer["price_breakdown"] = {
                        "input_tokens": input_tokens, "cached_input_tokens": cached_input_tokens,
                        "output_tokens": output_tokens,
                        "input_price": format(_price(applicable["input_price"], "input_price"), "f"),
                        "output_price": format(_price(applicable["output_price"], "output_price"), "f"),
                        "cached_input_price": None if cached_price is None else format(cached_price, "f"),
                        "uncached_input_cost": format(normal_cost, "f"),
                        "cached_input_cost": format(cached_cost, "f"),
                        "output_cost": format(output_cost, "f"),
                    }
                    offer["quote_status"] = "documented_estimate"
        output.append(_json_safe(offer))
    return {
        "requested_model": model_id,
        "model_id": canonical,
        "alias_note": mapping.get("alias_notes", {}).get(model_id),
        "as_of": now.isoformat().replace("+00:00", "Z"),
        "freshness_max_age_days": max_age,
        "execution_enabled": False,
        "offers": output,
        "limitations": list(dict.fromkeys([
            "Published list prices are not account-specific quotes; taxes and non-token charges are excluded.",
            "Documented availability does not establish credentials, quota, regional access, or live uptime.",
            "Unmeasured health and latency remain unknown and are not used to rank offers.",
            *mapping.get("limitations", []), *cost_catalog.get("limitations", []),
        ])),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", required=True)
    parser.add_argument("--input-tokens", type=int, default=1000)
    parser.add_argument("--output-tokens", type=int, default=500)
    parser.add_argument("--cached-input-tokens", type=int, default=0)
    args = parser.parse_args()
    try:
        result = compare_model_channels(args.model, args.input_tokens, args.output_tokens, args.cached_input_tokens)
    except (ModelMarketCatalogError, OSError, json.JSONDecodeError) as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False))
        raise SystemExit(2) from exc
    print(json.dumps(result, indent=2, ensure_ascii=False, allow_nan=False))


if __name__ == "__main__":
    main()
