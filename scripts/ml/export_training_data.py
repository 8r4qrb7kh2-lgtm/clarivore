#!/usr/bin/env python3
import argparse
import json
import os
import random
import re
import sys
import urllib.error
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path
from typing import Dict, Iterable, List, Sequence, Tuple

from model_utils import as_text, flatten_rows, write_json, write_jsonl


CANONICAL_RE = re.compile(r"[^a-z0-9]+")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Export Clarivore allergen/diet training data from Supabase into JSONL.",
    )
    parser.add_argument("--env-file", default=".env", help="Primary env file path.")
    parser.add_argument("--env-local-file", default=".env.local", help="Secondary env file path.")
    parser.add_argument(
        "--output-dir",
        default="ml/data/processed",
        help="Directory for processed output files.",
    )
    parser.add_argument(
        "--raw-output-dir",
        default="ml/data/raw",
        help="Directory for raw Supabase snapshots.",
    )
    parser.add_argument("--val-ratio", type=float, default=0.2, help="Validation split ratio.")
    parser.add_argument("--seed", type=int, default=7, help="Random seed for split shuffling.")
    parser.add_argument(
        "--no-brand-items",
        action="store_true",
        help="Disable pulling brand-item ingredient-label records.",
    )
    parser.add_argument(
        "--manual-labels",
        action="append",
        default=[],
        help="Additional JSONL files with manual labels to append.",
    )
    parser.add_argument(
        "--exclude-unlabeled",
        action="store_true",
        help="Exclude rows that have no allergen and no diet labels.",
    )
    return parser.parse_args()


def load_env(path: Path) -> None:
    if not path.exists():
        return

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export ") :].strip()
        if "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if not key or key in os.environ:
            continue

        if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
            value = value[1:-1]

        os.environ[key] = value


def canonical_token(value: str) -> str:
    return CANONICAL_RE.sub("", as_text(value).lower())


def supabase_fetch_all(base_url: str, api_key: str, path_with_query: str, page_size: int = 1000) -> List[Dict[str, object]]:
    out: List[Dict[str, object]] = []
    start = 0

    while True:
        end = start + page_size - 1
        url = f"{base_url.rstrip('/')}/rest/v1/{path_with_query}"
        request = urllib.request.Request(
            url,
            method="GET",
            headers={
                "apikey": api_key,
                "Authorization": f"Bearer {api_key}",
                "Accept": "application/json",
                "Range": f"{start}-{end}",
            },
        )

        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                payload_text = response.read().decode("utf-8")
                payload = json.loads(payload_text) if payload_text else []
        except urllib.error.HTTPError as error:
            message = error.read().decode("utf-8")
            raise RuntimeError(
                f"Supabase request failed for {path_with_query} ({error.code}): {message[:240]}"
            ) from error

        if not isinstance(payload, list):
            raise RuntimeError(f"Unexpected response shape for {path_with_query}: expected list")

        if not payload:
            break

        out.extend(payload)
        if len(payload) < page_size:
            break
        start += page_size

    return out


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


def read_manual_rows(paths: Sequence[str]) -> List[Dict[str, object]]:
    rows: List[Dict[str, object]] = []
    for path_text in paths:
        path = Path(path_text)
        if not path.exists():
            print(f"[warn] manual labels file not found: {path}")
            continue
        for raw_line in path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line:
                continue
            payload = json.loads(line)
            if not isinstance(payload, dict):
                continue
            rows.append(payload)
    return rows


def split_rows(rows: Sequence[Dict[str, object]], val_ratio: float, seed: int) -> Tuple[List[Dict[str, object]], List[Dict[str, object]]]:
    items = list(rows)
    if len(items) < 2:
        return items, []

    rng = random.Random(seed)
    rng.shuffle(items)

    raw_val_count = int(len(items) * max(0.0, min(0.9, float(val_ratio))))
    val_count = max(1, raw_val_count)
    val_count = min(val_count, len(items) - 1)

    val_rows = items[:val_count]
    train_rows = items[val_count:]
    return train_rows, val_rows


def summarize(rows: Sequence[Dict[str, object]], allergens: Sequence[str], diets: Sequence[str]) -> Dict[str, object]:
    allergen_counts = Counter()
    diet_counts = Counter()

    allergen_positive_rows = 0
    diet_positive_rows = 0

    for row in rows:
        row_allergens = stable_unique(row.get("allergens", []))
        row_diets = stable_unique(row.get("diets", []))

        if row_allergens:
            allergen_positive_rows += 1
        if row_diets:
            diet_positive_rows += 1

        allergen_counts.update(row_allergens)
        diet_counts.update(row_diets)

    return {
        "rows": len(rows),
        "allergen_positive_rows": allergen_positive_rows,
        "diet_positive_rows": diet_positive_rows,
        "allergen_counts": {label: int(allergen_counts.get(label, 0)) for label in allergens},
        "diet_counts": {label: int(diet_counts.get(label, 0)) for label in diets},
    }


def main() -> int:
    args = parse_args()

    load_env(Path(args.env_file))
    load_env(Path(args.env_local_file))

    base_url = as_text(os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL"))
    service_key = as_text(os.environ.get("SUPABASE_SERVICE_ROLE_KEY"))

    if not base_url or not service_key:
        print("Missing Supabase runtime config. Expected SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.")
        return 1

    output_dir = Path(args.output_dir)
    raw_output_dir = Path(args.raw_output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    raw_output_dir.mkdir(parents=True, exist_ok=True)

    allergens_rows = supabase_fetch_all(
        base_url,
        service_key,
        "allergens?select=id,key,label,is_active,sort_order&is_active=eq.true&order=sort_order.asc",
    )
    diets_rows = supabase_fetch_all(
        base_url,
        service_key,
        "diets?select=id,key,label,is_active,is_supported,is_ai_enabled,sort_order&is_active=eq.true&order=sort_order.asc",
    )

    ingredient_rows = supabase_fetch_all(
        base_url,
        service_key,
        "dish_ingredient_rows?select=id,restaurant_id,dish_name,row_index,row_text,created_at&row_text=not.is.null&order=created_at.asc",
    )
    ingredient_allergens = supabase_fetch_all(
        base_url,
        service_key,
        "dish_ingredient_allergens?select=ingredient_row_id,allergen_id,is_violation,is_cross_contamination,source",
    )
    ingredient_diets = supabase_fetch_all(
        base_url,
        service_key,
        "dish_ingredient_diets?select=ingredient_row_id,diet_id,is_violation,is_cross_contamination,source",
    )

    brand_rows: List[Dict[str, object]] = []
    if not args.no_brand_items:
        brand_rows = supabase_fetch_all(
            base_url,
            service_key,
            "restaurant_menu_ingredient_brand_items?select=id,ingredient_row_id,restaurant_id,dish_name,row_index,ingredient_list,ingredients_list,allergens,cross_contamination_allergens,diets,cross_contamination_diets,created_at",
        )

    # Persist raw snapshots for traceability and audit.
    write_json(raw_output_dir / "allergens.json", {"rows": allergens_rows})
    write_json(raw_output_dir / "diets.json", {"rows": diets_rows})
    write_json(raw_output_dir / "dish_ingredient_rows.json", {"rows": ingredient_rows})
    write_json(raw_output_dir / "dish_ingredient_allergens.json", {"rows": ingredient_allergens})
    write_json(raw_output_dir / "dish_ingredient_diets.json", {"rows": ingredient_diets})
    write_json(raw_output_dir / "brand_items.json", {"rows": brand_rows})

    allergen_id_to_key: Dict[str, str] = {}
    known_allergen_order: List[str] = []
    for row in allergens_rows:
        key = as_text(row.get("key"))
        row_id = as_text(row.get("id"))
        if not row_id or not key:
            continue
        allergen_id_to_key[row_id] = key
        if key not in known_allergen_order:
            known_allergen_order.append(key)

    diet_id_to_label: Dict[str, str] = {}
    known_diet_order: List[str] = []
    for row in diets_rows:
        row_id = as_text(row.get("id"))
        label = as_text(row.get("label"))
        if not row_id or not label:
            continue
        diet_id_to_label[row_id] = label
        if label not in known_diet_order:
            known_diet_order.append(label)

    allergen_by_row = defaultdict(lambda: {"contained": set(), "cross": set()})
    for row in ingredient_allergens:
        row_id = as_text(row.get("ingredient_row_id"))
        allergen_key = as_text(allergen_id_to_key.get(as_text(row.get("allergen_id"))))
        if not row_id or not allergen_key:
            continue
        if bool(row.get("is_violation")):
            allergen_by_row[row_id]["contained"].add(allergen_key)
        if bool(row.get("is_cross_contamination")):
            allergen_by_row[row_id]["cross"].add(allergen_key)

    diet_by_row = defaultdict(lambda: {"contained": set(), "cross": set()})
    for row in ingredient_diets:
        row_id = as_text(row.get("ingredient_row_id"))
        diet_label = as_text(diet_id_to_label.get(as_text(row.get("diet_id"))))
        if not row_id or not diet_label:
            continue
        if bool(row.get("is_violation")):
            diet_by_row[row_id]["contained"].add(diet_label)
        if bool(row.get("is_cross_contamination")):
            diet_by_row[row_id]["cross"].add(diet_label)

    observed_allergens = []
    observed_diets = []

    rows: List[Dict[str, object]] = []
    for row in ingredient_rows:
        row_id = as_text(row.get("id"))
        text = as_text(row.get("row_text"))
        if not row_id or not text:
            continue

        allergen_state = allergen_by_row[row_id]
        diet_state = diet_by_row[row_id]

        contained_allergens = stable_unique(allergen_state["contained"])
        cross_allergens = stable_unique(allergen_state["cross"])
        contained_diets = stable_unique(diet_state["contained"])
        cross_diets = stable_unique(diet_state["cross"])

        all_allergens = stable_unique(contained_allergens + cross_allergens)
        all_diets = stable_unique(contained_diets + cross_diets)

        observed_allergens.extend(all_allergens)
        observed_diets.extend(all_diets)

        rows.append(
            {
                "id": row_id,
                "text": text,
                "allergens": all_allergens,
                "diets": all_diets,
                "source": "dish_ingredient_rows",
                "meta": {
                    "restaurant_id": as_text(row.get("restaurant_id")),
                    "dish_name": as_text(row.get("dish_name")),
                    "row_index": row.get("row_index"),
                    "contained_allergens": contained_allergens,
                    "cross_contamination_allergens": cross_allergens,
                    "contained_diets": contained_diets,
                    "cross_contamination_diets": cross_diets,
                },
            }
        )

    allergen_token_lookup = {
        canonical_token(key): key
        for key in stable_unique(list(known_allergen_order) + list(observed_allergens))
        if canonical_token(key)
    }

    for row in brand_rows:
        text_parts: List[str] = []
        ingredient_list = as_text(row.get("ingredient_list"))
        if ingredient_list:
            text_parts.append(ingredient_list)

        for line in row.get("ingredients_list", []) or []:
            safe = as_text(line)
            if safe:
                text_parts.append(safe)

        text = "\n".join(stable_unique(text_parts)).strip()
        if not text:
            continue

        contained = []
        for item in row.get("allergens", []) or []:
            token = canonical_token(as_text(item))
            if not token:
                continue
            mapped = allergen_token_lookup.get(token)
            if mapped:
                contained.append(mapped)

        cross = []
        for item in row.get("cross_contamination_allergens", []) or []:
            token = canonical_token(as_text(item))
            if not token:
                continue
            mapped = allergen_token_lookup.get(token)
            if mapped:
                cross.append(mapped)

        all_allergens = stable_unique(contained + cross)
        observed_allergens.extend(all_allergens)

        rows.append(
            {
                "id": f"brand::{as_text(row.get('id'))}",
                "text": text,
                "allergens": all_allergens,
                "diets": [],
                "source": "restaurant_menu_ingredient_brand_items",
                "meta": {
                    "restaurant_id": as_text(row.get("restaurant_id")),
                    "dish_name": as_text(row.get("dish_name")),
                    "row_index": row.get("row_index"),
                    "contained_allergens": stable_unique(contained),
                    "cross_contamination_allergens": stable_unique(cross),
                    "notes": "Brand-item diet fields are compatibility labels, so they are excluded from violation targets.",
                },
            }
        )

    manual_rows = flatten_rows(read_manual_rows(args.manual_labels))
    if manual_rows:
        rows.extend(manual_rows)
        for row in manual_rows:
            observed_allergens.extend(stable_unique(row.get("allergens", [])))
            observed_diets.extend(stable_unique(row.get("diets", [])))

    rows = flatten_rows(rows)

    if args.exclude_unlabeled:
        rows = [
            row
            for row in rows
            if (row.get("allergens") or row.get("diets"))
        ]

    label_space = {
        "allergens": stable_unique(list(known_allergen_order) + list(observed_allergens)),
        "diets": stable_unique(list(known_diet_order) + list(observed_diets)),
    }

    train_rows, val_rows = split_rows(rows, args.val_ratio, args.seed)

    write_jsonl(output_dir / "all_examples.jsonl", rows)
    write_jsonl(output_dir / "train.jsonl", train_rows)
    write_jsonl(output_dir / "val.jsonl", val_rows)
    write_json(output_dir / "label_space.json", label_space)

    source_counts = Counter(as_text(row.get("source")) or "unknown" for row in rows)

    summary = {
        "dataset": summarize(rows, label_space["allergens"], label_space["diets"]),
        "train": summarize(train_rows, label_space["allergens"], label_space["diets"]),
        "val": summarize(val_rows, label_space["allergens"], label_space["diets"]),
        "sources": dict(source_counts),
        "config": {
            "val_ratio": float(args.val_ratio),
            "seed": int(args.seed),
            "excluded_unlabeled": bool(args.exclude_unlabeled),
            "brand_items_enabled": not bool(args.no_brand_items),
            "manual_files": [str(path) for path in args.manual_labels],
        },
    }

    write_json(output_dir / "dataset_summary.json", summary)

    print(f"Exported {len(rows)} total rows ({len(train_rows)} train / {len(val_rows)} val).")
    print(
        "Positive rows:",
        f"allergens={summary['dataset']['allergen_positive_rows']}",
        f"diets={summary['dataset']['diet_positive_rows']}",
    )
    print(f"Label space: {len(label_space['allergens'])} allergens, {len(label_space['diets'])} diets.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
