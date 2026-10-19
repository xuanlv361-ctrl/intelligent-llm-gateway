"""Run one local Scheduler MVP decision. No real API is called."""

from __future__ import annotations

import json
import sys
import argparse
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from decision_logger import DecisionLogger  # noqa: E402
from scheduler import Scheduler  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--log-path",
        type=Path,
        default=ROOT / "output" / "scheduler_demo_decisions_v1.jsonl",
    )
    args = parser.parse_args()
    logger = DecisionLogger(args.log_path)
    scheduler = Scheduler(logger=logger)
    decision = scheduler.schedule(
        {
            "request_id": "REQ001",
            "requested_model": "deepseek-v4-flash",
            "stream_required": False,
            "input_tokens": 1000,
            "output_tokens": 500,
            "currency": "CNY",
            "strategy": "confidence_aware_v2",
        }
    )
    print(json.dumps(decision, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
