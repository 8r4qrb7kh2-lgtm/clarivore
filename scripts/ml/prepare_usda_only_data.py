#!/usr/bin/env python3
"""Prepare USDA-only train/val/holdout JSONL and restricted label space."""

import argparse
import json
import random
import re
from collections import Counter
from pathlib import Path
from typing import Dict, Iterable, List, Sequence, Set, Tuple


ALLERGENS = [
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

ALLOWED_DIETS = ["Vegan", "Vegetarian", "Pescatarian", "Gluten-free"]
TREE_NUT_BASES = {"almond", "cashew", "coconut", "hazelnut", "macadamia", "pecan", "pistachio", "walnut"}
SOY_BASES = {"soy"}
PEANUT_BASES = {"peanut"}

PLANT_BASES = sorted(TREE_NUT_BASES | SOY_BASES | PEANUT_BASES | {"oat", "rice", "pea", "hemp", "flax", "quinoa"}, key=len, reverse=True)
PLANT_MILK_RE = re.compile(r"\b(" + "|".join(re.escape(base) for base in PLANT_BASES) + r")\s+milk\b", re.IGNORECASE)
PLANT_BUTTER_RE = re.compile(r"\b(" + "|".join(re.escape(base) for base in PLANT_BASES) + r")\s+butter\b", re.IGNORECASE)


def as_text(value: object) -> str:
    return str(value or "").strip()


def stable_unique(values: Iterable[str]) -> List[str]:
    out: List[str] = []
    seen: Set[str] = set()
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


def write_jsonl(path: Path, rows: Sequence[Dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False))
            handle.write("\n")


def write_json(path: Path, payload: Dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, sort_keys=True)
        handle.write("\n")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Create USDA-only ML dataset with restricted diets.")
    parser.add_argument("--train-input", default="ml/data/processed/usda_fdc_bulk_train_examples.jsonl")
    parser.add_argument("--holdout-input", default="ml/data/processed/usda_fdc_bulk_holdout_examples.jsonl")
    parser.add_argument("--train-output", default="ml/data/processed/usda_only_train.jsonl")
    parser.add_argument("--val-output", default="ml/data/processed/usda_only_val.jsonl")
    parser.add_argument("--holdout-output", default="ml/data/processed/usda_only_holdout.jsonl")
    parser.add_argument("--label-space-output", default="ml/data/processed/label_space_usda_only.json")
    parser.add_argument("--summary-output", default="ml/data/processed/usda_only_dataset_summary.json")
    parser.add_argument("--val-ratio", type=float, default=0.2)
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument(
        "--no-augment-plant-compounds",
        action="store_true",
        help="Disable semantic augmentations for plant milk/butter unit phrases.",
    )
    parser.add_argument(
        "--derive-gluten-free-violation-from-wheat",
        action="store_true",
        help="If set, add Gluten-free violation label whenever wheat allergen is present.",
    )
    return parser.parse_args()


def normalize_row(row: Dict[str, object], derive_gluten_from_wheat: bool) -> Dict[str, object]:
    allergens = [label for label in stable_unique(row.get("allergens", [])) if label in ALLERGENS]
    diets = [label for label in stable_unique(row.get("diets", [])) if label in ALLOWED_DIETS]

    if derive_gluten_from_wheat and "wheat" in allergens and "Gluten-free" not in diets:
        diets.append("Gluten-free")

    return {
        "id": as_text(row.get("id")),
        "text": as_text(row.get("text")),
        "allergens": allergens,
        "diets": diets,
        "source": as_text(row.get("source")) or "usda_fdc_bulk_branded",
        "meta": row.get("meta", {}),
    }


def split_rows(rows: Sequence[Dict[str, object]], val_ratio: float, seed: int) -> Tuple[List[Dict[str, object]], List[Dict[str, object]]]:
    items = list(rows)
    if len(items) < 2:
        return items, []

    rng = random.Random(seed)
    rng.shuffle(items)

    val_count = int(len(items) * max(0.0, min(0.9, float(val_ratio))))
    val_count = max(1, min(val_count, len(items) - 1))
    return items[val_count:], items[:val_count]


def summarize(rows: Sequence[Dict[str, object]]) -> Dict[str, object]:
    allergen_counts = Counter()
    diet_counts = Counter()

    for row in rows:
        allergen_counts.update(stable_unique(row.get("allergens", [])))
        diet_counts.update(stable_unique(row.get("diets", [])))

    return {
        "rows": len(rows),
        "allergen_positive_rows": sum(1 for row in rows if stable_unique(row.get("allergens", []))),
        "diet_positive_rows": sum(1 for row in rows if stable_unique(row.get("diets", []))),
        "allergen_counts": {label: int(allergen_counts.get(label, 0)) for label in ALLERGENS},
        "diet_counts": {label: int(diet_counts.get(label, 0)) for label in ALLOWED_DIETS},
    }


def plant_base_to_allergen(base: str) -> str:
    safe = as_text(base).lower()
    if safe in TREE_NUT_BASES:
        return "tree nut"
    if safe in SOY_BASES:
        return "soy"
    if safe in PEANUT_BASES:
        return "peanut"
    return ""


def build_semantic_augmentations(rows: Sequence[Dict[str, object]]) -> List[Dict[str, object]]:
    out: List[Dict[str, object]] = []

    for row in rows:
        row_id = as_text(row.get("id"))
        text = as_text(row.get("text"))
        if not text:
            continue

        augment_index = 0

        for pattern, suffix in ((PLANT_MILK_RE, "milk"), (PLANT_BUTTER_RE, "butter")):
            for match in pattern.finditer(text):
                base = as_text(match.group(1)).lower()
                allergen = plant_base_to_allergen(base)
                if not allergen:
                    continue

                phrase = f"{base} {suffix}"
                augment_index += 1
                out.append(
                    {
                        "id": f"aug::{row_id}::{suffix}::{augment_index}",
                        "text": phrase,
                        "allergens": [allergen],
                        "diets": [],
                        "source": "usda_semantic_augmentation",
                        "meta": {
                            "derived_from_id": row_id,
                            "phrase": phrase,
                            "rule": f"plant_{suffix}",
                        },
                    }
                )

    return out


def main() -> int:
    args = parse_args()

    train_input_path = Path(args.train_input)
    holdout_input_path = Path(args.holdout_input)

    if not train_input_path.exists() or not holdout_input_path.exists():
        print("Missing USDA bulk input files. Run fetch_usda_fdc_bulk.py first.")
        return 1

    normalized_train_source = [
        normalize_row(row, derive_gluten_from_wheat=bool(args.derive_gluten_free_violation_from_wheat))
        for row in load_jsonl(train_input_path)
    ]
    normalized_holdout = [
        normalize_row(row, derive_gluten_from_wheat=bool(args.derive_gluten_free_violation_from_wheat))
        for row in load_jsonl(holdout_input_path)
    ]

    filtered_train_source = [row for row in normalized_train_source if as_text(row.get("text"))]
    filtered_holdout = [row for row in normalized_holdout if as_text(row.get("text"))]

    train_rows, val_rows = split_rows(
        filtered_train_source,
        val_ratio=float(args.val_ratio),
        seed=int(args.seed),
    )

    augmentation_rows: List[Dict[str, object]] = []
    if not args.no_augment_plant_compounds:
        augmentation_rows = build_semantic_augmentations(train_rows)
        train_rows = list(train_rows) + augmentation_rows

    write_jsonl(Path(args.train_output), train_rows)
    write_jsonl(Path(args.val_output), val_rows)
    write_jsonl(Path(args.holdout_output), filtered_holdout)

    label_space = {
        "allergens": ALLERGENS,
        "diets": ALLOWED_DIETS,
    }
    write_json(Path(args.label_space_output), label_space)

    summary = {
        "config": {
            "seed": int(args.seed),
            "val_ratio": float(args.val_ratio),
            "augment_plant_compounds": not bool(args.no_augment_plant_compounds),
            "derive_gluten_free_violation_from_wheat": bool(args.derive_gluten_free_violation_from_wheat),
        },
        "label_space": label_space,
        "source_train_rows": len(normalized_train_source),
        "source_holdout_rows": len(normalized_holdout),
        "augmentation_rows": len(augmentation_rows),
        "train": summarize(train_rows),
        "val": summarize(val_rows),
        "holdout": summarize(filtered_holdout),
    }
    write_json(Path(args.summary_output), summary)

    print(
        "USDA-only dataset prepared: "
        f"train={len(train_rows)} val={len(val_rows)} holdout={len(filtered_holdout)}"
    )
    print(
        "Diet positives: "
        f"train={summary['train']['diet_positive_rows']} "
        f"val={summary['val']['diet_positive_rows']} "
        f"holdout={summary['holdout']['diet_positive_rows']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
