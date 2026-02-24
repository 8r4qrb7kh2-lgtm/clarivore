#!/usr/bin/env python3
"""Merge teacher-distilled labels into USDA student training rows."""

import argparse
import json
from collections import Counter
from pathlib import Path
from typing import Dict, Iterable, List, Sequence


ALLOWED_ALLERGENS = [
    "milk",
    "egg",
    "peanut",
    "tree nut",
    "shellfish",
    "fish",
    "soy",
    "sesame",
    "wheat",
]


def as_text(value: object) -> str:
    return str(value or "").strip()


def stable_unique(values: Iterable[str]) -> List[str]:
    out: List[str] = []
    seen = set()
    for value in values:
        safe = as_text(value)
        if not safe or safe in seen:
            continue
        seen.add(safe)
        out.append(safe)
    return out


def load_jsonl(path: Path) -> List[Dict[str, object]]:
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


def write_json(path: Path, payload: Dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, sort_keys=True)
        handle.write("\n")


def write_jsonl(path: Path, rows: Sequence[Dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False))
            handle.write("\n")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Apply teacher-distilled allergen labels to student train rows.")
    parser.add_argument("--train-input", default="ml/data/processed/usda_only_train.jsonl")
    parser.add_argument("--distilled-input", default="ml/data/processed/usda_teacher_distilled.jsonl")
    parser.add_argument("--train-output", default="ml/data/processed/usda_only_train_distilled.jsonl")
    parser.add_argument("--summary-output", default="ml/data/processed/usda_only_train_distilled_summary.json")
    parser.add_argument("--min-teacher-confidence", type=float, default=0.75)
    parser.add_argument(
        "--merge-mode",
        default="override",
        choices=["override", "union"],
        help="override replaces allergens with teacher set; union combines teacher+weak labels.",
    )
    return parser.parse_args()


def clamp01(value: float) -> float:
    return max(0.0, min(1.0, float(value)))


def safe_float(value: object, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return float(default)


def main() -> int:
    args = parse_args()

    train_input = Path(args.train_input)
    distilled_input = Path(args.distilled_input)
    train_output = Path(args.train_output)
    summary_output = Path(args.summary_output)

    if not train_input.exists():
        print(f"Missing train input: {train_input}")
        return 1
    if not distilled_input.exists():
        print(f"Missing distilled input: {distilled_input}")
        return 1

    train_rows = load_jsonl(train_input)
    distilled_rows = load_jsonl(distilled_input)

    teacher_by_id: Dict[str, Dict[str, object]] = {}
    for row in distilled_rows:
        row_id = as_text(row.get("id"))
        if not row_id:
            continue

        meta = row.get("meta", {}) or {}
        confidence = clamp01(safe_float(meta.get("teacher_confidence"), 0.0))
        if confidence < float(args.min_teacher_confidence):
            continue

        allergens = [label for label in stable_unique(row.get("allergens", [])) if label in ALLOWED_ALLERGENS]
        if not allergens:
            continue

        existing = teacher_by_id.get(row_id)
        existing_conf = safe_float(((existing or {}).get("meta", {}) or {}).get("teacher_confidence"), -1.0)
        if existing is None or confidence >= existing_conf:
            teacher_by_id[row_id] = {
                "allergens": allergens,
                "meta": {"teacher_confidence": confidence, "teacher_model": as_text(meta.get("teacher_model"))},
            }

    updated_rows: List[Dict[str, object]] = []
    applied = 0
    unchanged = 0
    allergen_counter = Counter()

    for row in train_rows:
        row_id = as_text(row.get("id"))
        weak_allergens = [label for label in stable_unique(row.get("allergens", [])) if label in ALLOWED_ALLERGENS]
        teacher = teacher_by_id.get(row_id)

        if teacher is None:
            allergens = weak_allergens
            unchanged += 1
        else:
            teacher_allergens = teacher["allergens"]
            if args.merge_mode == "union":
                allergens = stable_unique(weak_allergens + teacher_allergens)
            else:
                allergens = teacher_allergens
            applied += 1

        out_row = dict(row)
        out_row["allergens"] = allergens
        out_meta = dict((row.get("meta", {}) or {}))
        if teacher is not None:
            out_meta["distilled_teacher_confidence"] = teacher["meta"]["teacher_confidence"]
            out_meta["distilled_teacher_model"] = teacher["meta"]["teacher_model"]
            out_meta["distilled_merge_mode"] = args.merge_mode
        out_row["meta"] = out_meta
        updated_rows.append(out_row)
        allergen_counter.update(allergens)

    write_jsonl(train_output, updated_rows)

    summary = {
        "train_rows_in": len(train_rows),
        "distilled_rows_in": len(distilled_rows),
        "teacher_rows_eligible": len(teacher_by_id),
        "train_rows_out": len(updated_rows),
        "rows_teacher_applied": applied,
        "rows_unchanged": unchanged,
        "merge_mode": args.merge_mode,
        "min_teacher_confidence": float(args.min_teacher_confidence),
        "allergen_counts": {label: int(allergen_counter.get(label, 0)) for label in ALLOWED_ALLERGENS},
    }
    write_json(summary_output, summary)

    print(f"Wrote distilled train rows -> {train_output} ({len(updated_rows)})")
    print(f"Applied teacher labels on {applied} rows (unchanged {unchanged})")
    print(f"Summary -> {summary_output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
