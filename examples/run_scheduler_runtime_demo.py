"""Demonstrate all Scheduler Runtime v1 modes without real API calls."""

from __future__ import annotations

import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from scheduler import Scheduler  # noqa: E402


BASE = {
    "requested_model": "deepseek-v4-flash", "stream": False,
    "input_tokens": 1000, "output_tokens": 500, "currency": "CNY",
    "strategy": "confidence_aware_v2",
}


def main() -> None:
    scheduler = Scheduler(runtime_log_enabled=False)
    requests = [
        {**BASE, "request_id": "DEMO-SIM-001", "mode": "simulation"},
        {**BASE, "request_id": "DEMO-MOCK-001", "mode": "mock_execute"},
        {**BASE, "request_id": "DEMO-SHADOW-001", "mode": "real_shadow"},
        {**BASE, "request_id": "DEMO-REAL-BLOCKED-001", "mode": "real_execute"},
    ]
    print(json.dumps([scheduler.route(request) for request in requests], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
