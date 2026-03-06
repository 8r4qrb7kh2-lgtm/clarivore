#!/usr/bin/env python3
"""Build a prioritized manual-review queue for the ingredient catalog."""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
from typing import Dict, Iterable, List, Sequence


DEFAULT_INPUT = "ml/seeds/ingredient_catalog_seed.jsonl"
DEFAULT_OUTPUT = "ml/review/ingredient_catalog_review_queue.csv"
DEFAULT_REVIEW_FILE = "ml/review/ingredient_catalog_manual_review.jsonl"

HIGH_RISK_TERMS: Sequence[str] = (
    "blend",
    "cracker",
    "cookie",
    "cream",
    "extract",
    "flavor",
    "flour",
    "noodle",
    "oil",
    "paste",
    "sauce",
    "seasoning",
    "shortening",
    "spice",
    "stock",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build ingredient catalog review queue CSV.")
    parser.add_argument("--input", default=DEFAULT_INPUT)
    parser.add_argument("--output", default=DEFAULT_OUTPUT)
    parser.add_argument("--review-file", default=DEFAULT_REVIEW_FILE)
    return parser.parse_args()


def as_text(value: object) -> str:
    return str(value or "").strip()


def read_jsonl(path: Path) -> List[Dict[str, object]]:
    rows: List[Dict[str, object]] = []
    with path.open("r", encoding="utf-8") as handle:
        for raw_line in handle:
            line = raw_line.strip()
            if not line:
                continue
            payload = json.loads(line)
            if isinstance(payload, dict):
                rows.append(payload)
    return rows


def csv_list(values: Iterable[object]) -> str:
    out = [as_text(value) for value in values if as_text(value)]
    return " | ".join(out)


def compute_priority(row: Dict[str, object]) -> int:
    score = 0
    name = as_text(row.get("canonical_name")).lower()
    is_ready = row.get("is_ready") is True
    allergens = row.get("allergens") if isinstance(row.get("allergens"), list) else []
    diets = row.get("diets") if isinstance(row.get("diets"), list) else []
    lookup_count = int(row.get("lookup_count") or 0)
    metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
    blocked_diets = metadata.get("blocked_diets") if isinstance(metadata.get("blocked_diets"), list) else []
    reason_codes = metadata.get("reason_codes") if isinstance(metadata.get("reason_codes"), list) else []

    if not is_ready:
        score += 1000
    if allergens:
        score += 250 + (50 * len(allergens))
    if blocked_diets:
        score += 150 + (25 * len(blocked_diets))
    if len(diets) != 4:
        score += 80
    if lookup_count < 20:
        score += 100
    elif lookup_count < 100:
        score += 40
    if any(term in name for term in HIGH_RISK_TERMS):
        score += 60
    if any("review:" in as_text(code) for code in reason_codes):
        score += 75
    return score


def read_review_map(path: Path) -> Dict[str, Dict[str, object]]:
    if not path.exists():
        return {}

    review_rows = read_jsonl(path)
    review_map: Dict[str, Dict[str, object]] = {}
    for row in review_rows:
        normalized_name = as_text(row.get("normalized_name"))
        if normalized_name:
            review_map[normalized_name] = row
    return review_map


def main() -> int:
    args = parse_args()
    input_path = Path(args.input)
    output_path = Path(args.output)
    review_path = Path(args.review_file)
    rows = read_jsonl(input_path)
    review_map = read_review_map(review_path)

    queue_rows = []
    for row in rows:
        metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
        surface_forms = metadata.get("surface_forms") if isinstance(metadata.get("surface_forms"), list) else []
        datasets = metadata.get("datasets") if isinstance(metadata.get("datasets"), list) else []

        queue_rows.append(
            {
                "priority_score": compute_priority(row),
                "normalized_name": as_text(row.get("normalized_name")),
                "canonical_name": as_text(row.get("canonical_name")),
                "lookup_count": int(row.get("lookup_count") or 0),
                "is_ready": "yes" if row.get("is_ready") is True else "no",
                "allergens": csv_list(row.get("allergens") or []),
                "diets": csv_list(row.get("diets") or []),
                "blocked_diets": csv_list(metadata.get("blocked_diets") or []),
                "reason_codes": csv_list(metadata.get("reason_codes") or []),
                "top_surface_forms": csv_list(
                    [
                        f"{as_text(item.get('name'))} ({int(item.get('count') or 0)})"
                        for item in surface_forms[:5]
                        if isinstance(item, dict)
                    ]
                ),
                "datasets": csv_list(
                    [
                        f"{as_text(item.get('name'))}:{int(item.get('count') or 0)}"
                        for item in datasets
                        if isinstance(item, dict)
                    ]
                ),
                "review_status": as_text(review_map.get(as_text(row.get("normalized_name")), {}).get("status")),
                "review_notes": as_text(review_map.get(as_text(row.get("normalized_name")), {}).get("notes")),
            }
        )

    queue_rows.sort(
        key=lambda row: (
            -int(row["priority_score"]),
            -int(row["lookup_count"]),
            row["canonical_name"],
        )
    )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "priority_score",
                "normalized_name",
                "canonical_name",
                "lookup_count",
                "is_ready",
                "allergens",
                "diets",
                "blocked_diets",
                "reason_codes",
                "top_surface_forms",
                "datasets",
                "review_status",
                "review_notes",
            ],
        )
        writer.writeheader()
        writer.writerows(queue_rows)

    print(f"Wrote {len(queue_rows)} review rows to {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
