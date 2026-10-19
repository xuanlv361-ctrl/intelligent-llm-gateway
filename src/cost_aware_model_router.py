"""Model selection using documented prices and explicit capability preferences."""

from __future__ import annotations

import argparse
import json
import math
import sys
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from typing import Any, Mapping

from model_capability_router import (
    DEFAULT_CATALOG_PATH,
    compatibility_score,
    load_catalog,
)
from task_classifier import build_task_profile
from model_market_catalog import compare_model_channels


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_COST_CATALOG = ROOT / "data" / "model_cost_catalog_v1.json"
DEFAULT_POLICY = ROOT / "config" / "model_cost_policy_v1.json"
DEFAULT_OUTPUT = ROOT / "output" / "model_cost_decision_demo_v1.json"
COMPONENTS = ("capability", "cost", "latency")


class CostAwareModelError(ValueError):
    pass


def load_json(path: Path) -> dict[str, Any]:
    with Path(path).open(encoding="utf-8-sig") as handle:
        return json.load(handle)


def validate_cost_catalog(catalog: Mapping[str, Any]) -> None:
    models = catalog.get("models", [])
    identifiers = []
    for model in models:
        required = {
            "model_id", "input_price", "output_price", "currency",
            "cost_level", "latency_level",
        }
        if required - set(model):
            raise CostAwareModelError("cost catalog model is missing required fields")
        if any(not math.isfinite(float(model[key])) or float(model[key]) < 0
               for key in ("input_price", "output_price")):
            raise CostAwareModelError("model prices must be finite and non-negative")
        identifiers.append(model["model_id"])
    if not models or len(identifiers) != len(set(identifiers)):
        raise CostAwareModelError("cost catalog model_id must be non-empty and unique")


def validate_policy(policy: Mapping[str, Any]) -> None:
    objectives = policy.get("objectives", {})
    if set(objectives) != {"quality_first", "cost_first", "balanced"}:
        raise CostAwareModelError("policy must define three routing objectives")
    for objective, config in objectives.items():
        weights = config.get("weights", {})
        if set(weights) != set(COMPONENTS):
            raise CostAwareModelError(f"{objective} has invalid weight fields")
        if abs(sum(float(weights[key]) for key in COMPONENTS) - 1.0) > 1e-9:
            raise CostAwareModelError(f"{objective} weights must sum to 1")
    normalization = policy["price_normalization"]
    if (
        float(normalization["input_reference"]) <= 0
        or float(normalization["output_reference"]) <= 0
        or abs(
            float(normalization["input_share"])
            + float(normalization["output_share"]) - 1.0
        ) > 1e-9
    ):
        raise CostAwareModelError("invalid price normalization")


def _cost_score(model: Mapping[str, Any], policy: Mapping[str, Any]) -> float:
    config = policy["price_normalization"]
    penalty = (
        float(config["input_share"])
        * min(float(model["input_price"]) / float(config["input_reference"]), 1.0)
        + float(config["output_share"])
        * min(float(model["output_price"]) / float(config["output_reference"]), 1.0)
    )
    return max(0.0, 1.0 - penalty)


def select_model(
    task_profile: Mapping[str, Any],
    capability_catalog: Mapping[str, Any] | None = None,
    cost_catalog: Mapping[str, Any] | None = None,
    policy: Mapping[str, Any] | None = None,
    *,
    objective: str | None = None,
    now: datetime | None = None,
) -> dict[str, Any]:
    capability_catalog = capability_catalog or load_catalog(DEFAULT_CATALOG_PATH)
    cost_catalog = cost_catalog or load_json(DEFAULT_COST_CATALOG)
    policy = policy or load_json(DEFAULT_POLICY)
    validate_cost_catalog(cost_catalog)
    validate_policy(policy)
    objective = objective or str(policy["default_objective"])
    if objective not in policy["objectives"]:
        raise CostAwareModelError(f"unknown objective: {objective}")
    requirements = task_profile.get("requirements", {})
    if not requirements:
        raise CostAwareModelError("task_profile requires requirements")
    cost_by_id = {row["model_id"]: row for row in cost_catalog["models"]}
    bindings = cost_catalog.get("routing_bindings", {})
    capability_ids = {row["model_id"] for row in capability_catalog["models"]}
    if any(bindings.get(key, key) not in cost_by_id for key in capability_ids):
        raise CostAwareModelError("every capability model needs an explicit priced model binding")
    weights = policy["objectives"][objective]["weights"]
    requirement_total = sum(float(value) for value in requirements.values())
    if not math.isfinite(requirement_total) or requirement_total <= 0:
        raise CostAwareModelError("requirements must have positive total weight")
    ranking = []
    excluded = []
    # One unmeasured candidate must not gain or lose points through an invented
    # latency level. Omit that component for the whole comparison consistently.
    latency_available = all(cost_by_id[bindings.get(key, key)].get("latency_level")
                            in policy["latency_level_scores"] for key in capability_ids)
    used_components = COMPONENTS if latency_available else ("capability", "cost")
    total_weight = sum(float(weights[key]) for key in used_components)
    if total_weight <= 0:
        raise CostAwareModelError("no weight remains for measured/available components")
    effective_weights = {key: float(weights[key]) / total_weight if key in used_components else 0.0
                         for key in COMPONENTS}
    for model in capability_catalog["models"]:
        raw_capability, capability_explanation = compatibility_score(
            requirements, model
        )
        capability = raw_capability / requirement_total
        cost_model = cost_by_id[bindings.get(model["model_id"], model["model_id"])]
        price_evidence = None
        if cost_catalog.get("source_type") == "provider_published_list_prices":
            comparison = compare_model_channels(
                cost_model["model_id"], task_profile.get("input_tokens", 1000),
                task_profile.get("output_tokens", 500),
                task_profile.get("cached_input_tokens", 0),
                cost_catalog=cost_catalog, now=now)
            price_evidence = next((row for row in comparison["offers"]
                if row["channel_id"] == cost_model["reference_channel_id"]), None)
            if price_evidence is None or price_evidence["quote_status"] != "documented_estimate":
                excluded.append({"model": model["model_id"], "market_model_id": cost_model["model_id"],
                                 "reason": price_evidence["quote_status"] if price_evidence else "missing_reference_offer"})
                continue
            cost_model = {**cost_model, **price_evidence["price_breakdown"]}
        cost = _cost_score(cost_model, policy)
        if price_evidence is not None:
            breakdown = price_evidence["price_breakdown"]
            reference = (
                Decimal(breakdown["input_tokens"]) * Decimal(str(policy["price_normalization"]["input_reference"]))
                + Decimal(breakdown["output_tokens"]) * Decimal(str(policy["price_normalization"]["output_reference"]))
            ) / Decimal(1000000)
            cost = (float(max(Decimal(0), Decimal(1) - min(
                Decimal(price_evidence["estimated_cost"]) / reference, Decimal(1))))
                if reference else 1.0)
        latency = (float(policy["latency_level_scores"][cost_model["latency_level"]])
                   if latency_available else None)
        total = (
            effective_weights["capability"] * capability
            + effective_weights["cost"] * cost
            + effective_weights["latency"] * (latency or 0.0)
        )
        ranking.append({
            "model": cost_model["model_id"],
            "model_preference": model["model_id"],
            "market_model_id": cost_model["model_id"],
            "score": round(total, 6),
            "score_breakdown": {
                "capability_score": round(capability, 6),
                "cost_score": round(cost, 6),
                "latency_score": round(latency, 6) if latency is not None else None,
                "weighted_capability": round(effective_weights["capability"] * capability, 6),
                "weighted_cost": round(effective_weights["cost"] * cost, 6),
                "weighted_latency": round(effective_weights["latency"] * (latency or 0.0), 6),
            },
            "capability_explanation": capability_explanation,
            "input_price": cost_model["input_price"],
            "output_price": cost_model["output_price"],
            "currency": cost_model["currency"],
            "price_source_url": cost_model.get("price_source_url"),
            "reference_channel_id": cost_model.get("reference_channel_id"),
            "price_verified_at": cost_model.get("verified_at"),
            "price_tier": price_evidence["applicable_tier"] if price_evidence else None,
            "estimated_request_cost": price_evidence["estimated_cost"] if price_evidence else None,
            "request_price_breakdown": price_evidence["price_breakdown"] if price_evidence else None,
        })
    if not ranking:
        raise CostAwareModelError("no current documented prices available for model selection")
    ranking.sort(key=lambda row: (-row["score"], row["model"]))
    selected = ranking[0]
    return {
        "selected_model": selected["model"],
        "selected_model_preference": selected["model_preference"],
        "selected_market_model": selected["market_model_id"],
        "ranking": ranking,
        "excluded_models": excluded,
        "effective_weights": effective_weights,
        "unavailable_components": [] if latency_available else ["latency"],
        "score_breakdown": selected["score_breakdown"],
        "explanation": (
            f"{objective}: capability={selected['score_breakdown']['capability_score']}, "
            f"cost={selected['score_breakdown']['cost_score']}, "
            f"latency={selected['score_breakdown']['latency_score']}; "
            "capability scores are application preferences, not measured benchmarks"
        ),
        "objective": objective,
        "policy_version": policy["policy_version"],
        "source_type": cost_catalog.get("source_type", "configured_model_selection"),
        "real_api_called": False,
    }


def build_demo(*, now: datetime | None = None) -> dict[str, Any]:
    scenarios = [
        ("coding_request", "Implement Python code and debug this function", "quality_first"),
        ("simple_question", "What is a transformer?", "balanced"),
        ("long_document_analysis", "Summarize this long document", "balanced"),
    ]
    rows = []
    for scenario_id, text, objective in scenarios:
        profile = build_task_profile(text)
        rows.append({
            "scenario_id": scenario_id,
            "request_text": text,
            "task": profile,
            **select_model(profile, objective=objective, now=now),
        })
    return {
        "demonstration_type": "offline_only",
        "real_api_calls_performed": 0,
        "scenarios": rows,
        "limitations": [
            "Prices are source-backed public list prices. Capability scores remain application heuristics.",
            "No unmeasured latency values are invented; this module performs selection without inference calls."
        ],
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    try:
        output = build_demo()
        if not args.dry_run:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(
                json.dumps(output, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
        print(json.dumps({
            "status": "ok", "scenario_count": len(output["scenarios"]),
            "dry_run": args.dry_run, "real_api_calls_performed": 0,
        }, ensure_ascii=False))
        return 0
    except (OSError, ValueError, KeyError, TypeError) as exc:
        print(json.dumps({"status": "error", "error": str(exc)}, ensure_ascii=False),
              file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
