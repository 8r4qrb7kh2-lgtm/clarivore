#!/usr/bin/env python3
"""Split the ingredient catalog review queue into parallel audit lanes."""

from __future__ import annotations

import argparse
import csv
import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Dict, Iterable, List


DEFAULT_INPUT = "ml/review/ingredient_catalog_review_queue.csv"
DEFAULT_OUTPUT_DIR = "ml/review/shards"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Split ingredient catalog review queue into shards.")
    parser.add_argument("--input", default=DEFAULT_INPUT)
    parser.add_argument("--output-dir", default=DEFAULT_OUTPUT_DIR)
    parser.add_argument(
        "--include-reviewed",
        action="store_true",
        help="Include rows that already have a review_status.",
    )
    return parser.parse_args()


def as_text(value: object) -> str:
    return str(value or "").strip()


def split_codes(value: str) -> List[str]:
    return [part.strip() for part in as_text(value).split("|") if part.strip()]


def classify_lane(row: Dict[str, str]) -> str:
    name = as_text(row.get("normalized_name")).lower()
    reason_codes = split_codes(row.get("reason_codes", ""))

    if "extract" in name or "review:generic_extract" in reason_codes:
        return "extracts"
    if "sauce" in name or "dressing" in name:
        return "sauces"
    if "flavor" in name or "review:ambiguous_generic" in reason_codes:
        return "flavors"
    if "review:product_style" in reason_codes:
        return "products"
    return "other"


def read_rows(path: Path) -> List[Dict[str, str]]:
    with path.open("r", encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def write_rows(path: Path, rows: Iterable[Dict[str, str]], fieldnames: List[str]) -> int:
    row_list = list(rows)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(row_list)
    return len(row_list)


def main() -> int:
    args = parse_args()
    input_path = Path(args.input)
    output_dir = Path(args.output_dir)
    rows = read_rows(input_path)
    fieldnames = list(rows[0].keys()) if rows else []

    lane_rows: Dict[str, List[Dict[str, str]]] = defaultdict(list)
    lane_counts: Counter[str] = Counter()

    for row in rows:
        if not args.include_reviewed and as_text(row.get("review_status")):
            continue
        lane = classify_lane(row)
        lane_rows[lane].append(row)
        lane_counts[lane] += 1

    summary = {
        "input_rows": len(rows),
        "included_reviewed": bool(args.include_reviewed),
        "lanes": {},
    }

    for lane, lane_list in sorted(lane_rows.items()):
        lane_path = output_dir / f"{lane}.csv"
        count = write_rows(lane_path, lane_list, fieldnames)
        summary["lanes"][lane] = {
            "count": count,
            "path": str(lane_path),
        }

    summary_path = output_dir / "summary.json"
    summary_path.write_text(json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"Wrote review shards to {output_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
