"""Source identity, exact prices, freshness and unknown-health contracts."""

from copy import deepcopy
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import json
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from model_market_catalog import (
    ModelMarketCatalogError,
    compare_model_channels,
    load_cost_catalog,
    load_mapping,
    resolve_model_id,
    validate_market_catalog,
)


VERIFIED = "2026-10-19T00:00:00Z"
NOW = datetime(2026, 10, 19, 12, tzinfo=timezone.utc)


@pytest.fixture
def catalogs():
    offer = {
        "candidate_id": "PROVIDER-A", "channel_id": "PROVIDER-A", "provider": "Provider A",
        "provider_model_id": "model-a-20261019", "api_base": "https://api.example.test",
        "api_path": "/v1/messages", "api_format": "messages", "priority": 10,
        "is_mock": False, "availability_status": "documented",
        "verification_status": "provider_documented",
        "source_urls": ["https://example.test/model-a"], "verified_at": VERIFIED,
        "execution_enabled": False,
        "health": {"sample_count": 0, "success_rate": None, "p95_latency_ms": None,
                   "ttft_ms": None, "status": "unmeasured"},
    }
    price = {
        "channel_id": "PROVIDER-A", "model_id": "model-a", "provider_model_id": "model-a-20261019",
        "currency": "USD", "price_unit": "currency_per_1m_tokens",
        "input_price": "0.27", "output_price": "1.1", "cached_input_price": "0.027",
        "source_urls": ["https://example.test/pricing"], "verified_at": VERIFIED,
        "pricing_tiers": [], "notes": [],
    }
    mapping = {
        "mapping_version": "test", "verified_at": VERIFIED, "freshness_max_age_days": 7,
        "model_aliases": {"legacy-a": "model-a"}, "ambiguous_model_aliases": {},
        "models": {"model-a": [offer]},
    }
    costs = {
        "catalog_version": "test", "verified_at": VERIFIED,
        "price_unit": "currency_per_1m_tokens", "currency": "USD", "models": [],
        "channel_prices": [price],
    }
    return mapping, costs


def compare(catalogs, **kwargs):
    mapping, costs = catalogs
    return compare_model_channels("model-a", mapping=mapping, cost_catalog=costs, now=NOW, **kwargs)


def test_exact_cost_counts_cached_input_once_and_retains_unknown_health(catalogs):
    result = compare(catalogs, input_tokens=10000, output_tokens=2000, cached_input_tokens=1000)
    offer = result["offers"][0]
    assert offer["estimated_cost"] == "0.004657"
    assert offer["quote_status"] == "documented_estimate"
    assert offer["health"] == catalogs[0]["models"]["model-a"][0]["health"]
    assert offer["health"]["success_rate"] is None
    assert offer["execution_enabled"] is False
    assert result["execution_enabled"] is False
    assert set(offer["source_urls"]) == {"https://example.test/model-a", "https://example.test/pricing"}


def test_configured_alias_resolves_without_conflating_models(catalogs):
    mapping, costs = catalogs
    result = compare_model_channels("legacy-a", mapping=mapping, cost_catalog=costs, now=NOW)
    assert result["model_id"] == "model-a"
    mapping["models"]["model-b"] = []
    mapping["ambiguous_model_aliases"]["gpt-4o-4-1"] = ["model-a", "model-b"]
    with pytest.raises(ModelMarketCatalogError, match="ambiguous.*model-a.*model-b"):
        compare_model_channels("gpt-4o-4-1", mapping=mapping, cost_catalog=costs, now=NOW)
    with pytest.raises(ModelMarketCatalogError, match="unknown"):
        resolve_model_id("invented-model", mapping)


@pytest.mark.parametrize("location", ["mapping", "catalog", "offer", "price"])
def test_any_stale_source_prevents_current_quote(catalogs, location):
    mapping, costs = catalogs
    target = {"mapping": mapping, "catalog": costs, "offer": mapping["models"]["model-a"][0],
              "price": costs["channel_prices"][0]}[location]
    target["verified_at"] = "2026-10-01T00:00:00Z"
    offer = compare(catalogs)["offers"][0]
    assert offer["quote_status"] == "stale"
    assert offer["estimated_cost"] is None


def test_future_verification_is_not_a_current_quote(catalogs):
    catalogs[0]["verified_at"] = "2026-10-20T00:00:00Z"
    assert compare(catalogs)["offers"][0]["quote_status"] == "not_yet_verified"


def test_stricter_cost_catalog_freshness_is_not_ignored(catalogs):
    mapping, costs = catalogs
    mapping["freshness_max_age_days"] = 30
    costs["freshness_max_age_days"] = 2
    result = compare_model_channels("model-a", mapping=mapping, cost_catalog=costs, now=NOW+timedelta(days=3))
    assert result["freshness_max_age_days"] == 2
    assert result["offers"][0]["quote_status"] == "stale"
    assert result["offers"][0]["estimated_cost"] is None


def test_sunset_is_enforced_at_exact_boundary(catalogs):
    mapping, costs = catalogs
    mapping["models"]["model-a"][0]["sunset_at"] = "2026-10-19T12:00:00Z"
    offer = compare(catalogs)["offers"][0]
    assert offer["quote_status"] == "retired"
    assert offer["estimated_cost"] is None
    before = compare_model_channels("model-a", mapping=mapping, cost_catalog=costs, now=NOW-timedelta(seconds=1))
    assert before["offers"][0]["quote_status"] == "documented_estimate"


def test_documented_prices_choose_correct_context_and_time_tier(catalogs):
    price = catalogs[1]["channel_prices"][0]
    base = {"cached_input_price": None, "valid_from": None, "valid_until": None, "conditions": []}
    price["pricing_tiers"] = [
        dict(base, tier_id="small", input_tokens_min=0, input_tokens_max=200000, input_price="1", output_price="4"),
        dict(base, tier_id="large", input_tokens_min=200001, input_tokens_max=1000000, input_price="2", output_price="8"),
    ]
    small = compare(catalogs, input_tokens=200000, output_tokens=100)["offers"][0]
    large = compare(catalogs, input_tokens=200001, output_tokens=100)["offers"][0]
    assert small["applicable_tier"]["tier_id"] == "small"
    assert small["estimated_cost"] == "0.2004"
    assert large["applicable_tier"]["tier_id"] == "large"
    assert large["estimated_cost"] == "0.400802"
    price["pricing_tiers"][0]["valid_until"] = "2026-10-19T12:00:00Z"
    assert compare(catalogs)["offers"][0]["quote_status"] == "no_applicable_price_tier"


def test_out_of_tier_does_not_silently_fall_back_to_base_price(catalogs):
    catalogs[1]["channel_prices"][0]["pricing_tiers"] = [{
        "tier_id": "small", "input_tokens_min": 0, "input_tokens_max": 100,
        "input_price": "1", "output_price": "2", "cached_input_price": None,
    }]
    offer = compare(catalogs, input_tokens=101)["offers"][0]
    assert offer["quote_status"] == "no_applicable_price_tier"
    assert offer["estimated_cost"] is None


def test_overlapping_tiers_do_not_choose_arbitrary_price(catalogs):
    tier = {"tier_id": "a", "input_tokens_min": 0, "input_tokens_max": None,
            "input_price": "1", "output_price": "2", "cached_input_price": None}
    catalogs[1]["channel_prices"][0]["pricing_tiers"] = [tier, dict(tier, tier_id="b")]
    offer = compare(catalogs)["offers"][0]
    assert offer["quote_status"] == "ambiguous_price_tier"
    assert offer["estimated_cost"] is None


def test_unknown_cache_pricing_never_charges_zero(catalogs):
    catalogs[1]["channel_prices"][0]["cached_input_price"] = None
    assert compare(catalogs, cached_input_tokens=1)["offers"][0]["quote_status"] == "unknown_cached_price"
    assert compare(catalogs)["offers"][0]["quote_status"] == "documented_estimate"


@pytest.mark.parametrize("field,value", [("input_tokens", -1), ("input_tokens", 1.1),
                                         ("output_tokens", True), ("cached_input_tokens", 1001)])
def test_invalid_token_inputs_rejected(catalogs, field, value):
    with pytest.raises(ModelMarketCatalogError):
        compare(catalogs, **{field: value})


@pytest.mark.parametrize("bad_price", ["NaN", "Infinity", "-Infinity", "-0.1", True, None])
def test_invalid_nonfinite_or_negative_prices_rejected(catalogs, bad_price):
    catalogs[1]["channel_prices"][0]["input_price"] = bad_price
    with pytest.raises(ModelMarketCatalogError, match="finite non-negative"):
        compare(catalogs)


@pytest.mark.parametrize("field,value", [("model_id", "model-b"), ("provider_model_id", "different-model"),
                                         ("channel_id", "UNRELATED")])
def test_price_identity_cannot_cross_join_models(catalogs, field, value):
    catalogs[1]["channel_prices"][0][field] = value
    with pytest.raises(ModelMarketCatalogError, match="join|identity"):
        compare(catalogs)


@pytest.mark.parametrize("field,value", [("input_price", "999"), ("output_price", "999"),
                                         ("cached_input_price", "999"), ("currency", "GBP"),
                                         ("price_source_url", "https://example.test/unrelated")])
def test_model_reference_prices_cannot_disagree_with_channel(catalogs, field, value):
    row = deepcopy(catalogs[1]["channel_prices"][0])
    row.update(reference_channel_id=row["channel_id"], model_name="Model A", cost_level="low",
               latency_level=None, price_source_url=row["source_urls"][0])
    row[field] = value
    catalogs[1]["models"] = [row]
    with pytest.raises(ModelMarketCatalogError, match="reference"):
        compare(catalogs)


def test_rolling_alias_requires_resolved_version(catalogs):
    catalogs[0]["models"]["model-a"][0]["model_id_kind"] = "rolling_alias"
    with pytest.raises(ModelMarketCatalogError, match="rolling alias"):
        compare(catalogs)


def test_missing_price_keeps_channel_visible_without_estimate(catalogs):
    catalogs[1]["channel_prices"] = []
    offer = compare(catalogs)["offers"][0]
    assert offer["quote_status"] == "missing_price"
    assert offer["estimated_cost"] is None


def test_documented_mapping_cannot_silently_enable_execution(catalogs):
    catalogs[0]["models"]["model-a"][0]["execution_enabled"] = True
    with pytest.raises(ModelMarketCatalogError, match="execution disabled"):
        compare(catalogs)


def test_invented_health_without_samples_rejected(catalogs):
    catalogs[0]["models"]["model-a"][0]["health"]["success_rate"] = 0.999
    with pytest.raises(ModelMarketCatalogError, match="unmeasured"):
        compare(catalogs)


def test_deterministic_and_does_not_mutate_catalogs(catalogs):
    original = deepcopy(catalogs)
    first = compare(catalogs)
    second = compare(catalogs)
    assert json.dumps(first, sort_keys=True) == json.dumps(second, sort_keys=True)
    assert catalogs == original
    first["offers"][0]["health"]["status"] = "invented"
    assert catalogs == original


def test_offers_use_configured_priority_then_stable_id(catalogs):
    mapping, costs = catalogs
    second = deepcopy(mapping["models"]["model-a"][0])
    second.update(channel_id="PROVIDER-B", candidate_id="PROVIDER-B", priority=10)
    mapping["models"]["model-a"].insert(0, second)
    assert [offer["channel_id"] for offer in compare(catalogs)["offers"]] == ["PROVIDER-A", "PROVIDER-B"]


def test_file_loader_preserves_decimal_price_precision(catalogs, tmp_path):
    mapping, costs = catalogs
    costs["channel_prices"][0]["input_price"] = 0.27
    mapping_path, cost_path = tmp_path / "mapping.json", tmp_path / "prices.json"
    mapping_path.write_text(json.dumps(mapping), encoding="utf-8")
    cost_path.write_text(json.dumps(costs), encoding="utf-8")
    loaded = load_cost_catalog(cost_path)
    assert loaded["channel_prices"][0]["input_price"] == Decimal("0.27")
    assert load_mapping(mapping_path) == mapping


@pytest.mark.parametrize("bad_time", ["2026-10-19", "2026-10-19T00:00:00", "2026-10-19T00:00:00+01:00"])
def test_catalog_verification_times_must_be_utc(catalogs, bad_time):
    catalogs[0]["verified_at"] = bad_time
    with pytest.raises(ModelMarketCatalogError, match="UTC"):
        compare(catalogs)


def test_checked_in_market_catalog_is_joinable_and_health_is_not_fabricated():
    mapping, costs = load_mapping(), load_cost_catalog()
    validate_market_catalog(mapping, costs)
    when = datetime.fromisoformat(mapping["verified_at"].replace("Z", "+00:00"))
    for model_id in mapping["models"]:
        result = compare_model_channels(model_id, mapping=mapping, cost_catalog=costs, now=when)
        assert result["offers"]
        for offer in result["offers"]:
            assert offer["is_mock"] is False
            assert offer["execution_enabled"] is False
            assert offer["health"]["sample_count"] == 0
            assert offer["health"]["success_rate"] is None
            assert offer["health"]["p95_latency_ms"] is None
            assert offer["source_urls"]


@pytest.mark.parametrize("input_tokens,tier,expected_cost", [
    (256000, "singapore_up_to_256k", "0.104"),
    (256001, "singapore_over_256k", "0.3120012"),
])
def test_actual_qwen_context_tier_boundary(input_tokens, tier, expected_cost):
    mapping, costs = load_mapping(), load_cost_catalog()
    result = compare_model_channels("qwen", input_tokens=input_tokens, output_tokens=1000,
                                    mapping=mapping, cost_catalog=costs, now=NOW)
    offer = result["offers"][0]
    assert offer["quote_status"] == "documented_estimate"
    assert offer["applicable_tier"]["tier_id"] == tier
    assert Decimal(offer["estimated_cost"]) == Decimal(expected_cost)
    assert offer["region"] == "ap-southeast-1"


def _reverify_copies_at(mapping, costs, when):
    """Advance metadata on copies so lifecycle/tier tests do not test staleness."""
    mapping, costs = deepcopy(mapping), deepcopy(costs)
    stamp = when.isoformat().replace("+00:00", "Z")
    for catalog in (mapping, costs):
        catalog["verified_at"] = stamp
    for offers in mapping["models"].values():
        for offer in offers:
            offer["verified_at"] = stamp
    for row in costs["models"] + costs["channel_prices"]:
        row["verified_at"] = stamp
    return mapping, costs


def test_actual_gemini_price_transition_at_january_first():
    mapping, costs = load_mapping(), load_cost_catalog()
    boundary = datetime(2027, 1, 1, tzinfo=timezone.utc)
    mapping, costs = _reverify_copies_at(mapping, costs, boundary-timedelta(days=1))
    before = compare_model_channels("gemini-flash", 10000, 2000, now=boundary-timedelta(seconds=1),
                                    mapping=mapping, cost_catalog=costs)["offers"][0]
    after = compare_model_channels("gemini-flash", 10000, 2000, now=boundary,
                                   mapping=mapping, cost_catalog=costs)["offers"][0]
    assert before["quote_status"] == after["quote_status"] == "documented_estimate"
    assert before["applicable_tier"]["tier_id"] == "paid_standard_2026"
    assert after["applicable_tier"]["tier_id"] == "paid_standard_2027"
    assert Decimal(before["estimated_cost"]) == Decimal("0.015")
    assert Decimal(after["estimated_cost"]) == Decimal("0.03")


@pytest.mark.parametrize("model", ["gpt-4o", "gpt-4.1"])
def test_actual_openai_sunset_prevents_quotes_at_boundary(model):
    mapping, costs = load_mapping(), load_cost_catalog()
    boundary = datetime(2027, 1, 14, tzinfo=timezone.utc)
    mapping, costs = _reverify_copies_at(mapping, costs, boundary-timedelta(days=1))
    before = compare_model_channels(model, now=boundary-timedelta(seconds=1), mapping=mapping,
                                    cost_catalog=costs)["offers"][0]
    after = compare_model_channels(model, now=boundary, mapping=mapping, cost_catalog=costs)["offers"][0]
    assert before["quote_status"] == "documented_estimate"
    assert after["quote_status"] == "retired"
    assert after["estimated_cost"] is None


def test_actual_deepseek_three_channels_keep_identity_and_equal_published_prices():
    mapping, costs = load_mapping(), load_cost_catalog()
    result = compare_model_channels("deepseek-reasoner", 10000, 2000, now=NOW,
                                    mapping=mapping, cost_catalog=costs)
    assert result["model_id"] == "deepseek-v4.1-flash-1017"
    assert "not DeepSeek R1" in result["alias_note"]
    offers = result["offers"]
    assert len(offers) == 3
    assert {offer["provider"] for offer in offers} == {"DeepSeek", "Together AI", "Fireworks AI"}
    assert len({offer["provider_model_id"] for offer in offers}) == 3
    assert {Decimal(offer["estimated_cost"]) for offer in offers} == {Decimal("0.0054")}
    assert all(offer["quote_status"] == "documented_estimate" for offer in offers)
    assert offers[0]["model_id_kind"] == "rolling_alias"
    assert offers[0]["resolved_version_at_verification"] == "DeepSeek-V4.1-Flash-1017"
    assert all(offer["model_id_kind"] == "versioned" for offer in offers[1:])
    assert all(offer["health"]["status"] == "unmeasured" for offer in offers)


def test_runtime_has_no_network_imports():
    import ast
    import model_market_catalog
    tree = ast.parse(Path(model_market_catalog.__file__).read_text(encoding="utf-8"))
    modules = {alias.name.split(".")[0] for node in ast.walk(tree) if isinstance(node, ast.Import) for alias in node.names}
    modules |= {node.module.split(".")[0] for node in ast.walk(tree) if isinstance(node, ast.ImportFrom) and node.module}
    assert not modules & {"requests", "httpx", "urllib", "socket", "aiohttp"}
