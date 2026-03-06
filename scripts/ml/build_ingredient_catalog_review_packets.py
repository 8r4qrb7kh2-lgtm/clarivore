#!/usr/bin/env python3
"""Build Codex-friendly review packets for the ingredient catalog."""

from __future__ import annotations

import argparse
import csv
import json
import shutil
from collections import defaultdict
from pathlib import Path
from typing import Dict, Iterable, List, Sequence


DEFAULT_QUEUE_FILE = "ml/review/ingredient_catalog_review_queue.csv"
DEFAULT_SEED_FILE = "ml/seeds/ingredient_catalog_seed.jsonl"
DEFAULT_OUTPUT_DIR = "ml/review/packets"

PACKET_SIZES: Dict[str, int] = {
    "extracts": 25,
    "sauces": 25,
    "flavors": 30,
    "products": 25,
    "other": 100,
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build Codex review packets for ingredient catalog rows.")
    parser.add_argument("--queue-file", default=DEFAULT_QUEUE_FILE)
    parser.add_argument("--seed-file", default=DEFAULT_SEED_FILE)
    parser.add_argument("--output-dir", default=DEFAULT_OUTPUT_DIR)
    parser.add_argument(
        "--clean",
        action="store_true",
        help="Remove the existing packets directory before rebuilding packets.",
    )
    parser.add_argument(
        "--include-reviewed",
        action="store_true",
        help="Include rows that already have a review_status in the queue.",
    )
    return parser.parse_args()


def as_text(value: object) -> str:
    return str(value or "").strip()


def split_pipe_list(value: object) -> List[str]:
    text = as_text(value)
    if not text:
        return []
    return [part.strip() for part in text.split("|") if part.strip()]


def classify_lane(row: Dict[str, str]) -> str:
    name = as_text(row.get("normalized_name")).lower()
    reason_codes = split_pipe_list(row.get("reason_codes"))

    if "extract" in name or "review:generic_extract" in reason_codes:
        return "extracts"
    if "sauce" in name or "dressing" in name:
        return "sauces"
    if "flavor" in name or "review:ambiguous_generic" in reason_codes:
        return "flavors"
    if "review:product_style" in reason_codes:
        return "products"
    return "other"


def read_csv_rows(path: Path) -> List[Dict[str, str]]:
    with path.open("r", encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def read_seed_map(path: Path) -> Dict[str, Dict[str, object]]:
    rows: Dict[str, Dict[str, object]] = {}
    with path.open("r", encoding="utf-8") as handle:
        for raw_line in handle:
            line = raw_line.strip()
            if not line:
                continue
            row = json.loads(line)
            normalized_name = as_text(row.get("normalized_name"))
            if normalized_name:
                rows[normalized_name] = row
    return rows


def iter_chunks(rows: Sequence[Dict[str, object]], size: int) -> Iterable[Sequence[Dict[str, object]]]:
    for start in range(0, len(rows), size):
        yield rows[start : start + size]


def write_jsonl(path: Path, rows: Sequence[Dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False))
            handle.write("\n")


def build_packet_prompt(
    packet_id: str,
    lane: str,
    row_count: int,
    input_path: Path,
    submission_path: Path,
) -> str:
    return f"""# {packet_id}

Review the ingredient rows in `{input_path}` manually using only local repo context and your own reasoning.
Do not use any external AI API or paid model endpoint. Codex only.

Lane: `{lane}`
Rows in packet: `{row_count}`
Write decisions to: `{submission_path}`

Decision rules:

1. Use `verified` when the current seed row is correct and safe as-is.
2. Use `corrected` when you need to change allergens, diets, or `is_ready`.
3. Use `verified_fallback` when the row should remain `is_ready: false` because it is too composite, ambiguous, or formulation-dependent for direct lookup.

Output format:

Write exactly one JSON object per row to `submission.jsonl`.

Fields:
- `normalized_name`: exact row key from the packet input
- `status`: `verified`, `corrected`, or `verified_fallback`
- `notes`: short rationale
- `reviewer`: use `codex`
- `reviewed_at`: use `2026-03-06`
- `allergens`: optional string array when changing allergens
- `diets`: optional string array when changing diets
- `is_ready`: optional boolean; include `false` for `verified_fallback`

Example:

```json
{{"normalized_name":"soy sauce","status":"corrected","notes":"Observed rows consistently disclose soybeans plus wheat.","reviewer":"codex","reviewed_at":"2026-03-06","allergens":["soy","wheat"],"diets":["Vegan","Vegetarian","Pescatarian"],"is_ready":true}}
{{"normalized_name":"natural flavor","status":"verified_fallback","notes":"Highly variable umbrella term; keep fallback-only.","reviewer":"codex","reviewed_at":"2026-03-06","is_ready":false}}
```
"""


def build_root_readme(output_dir: Path, manifest_path: Path) -> str:
    return f"""# Ingredient Catalog Review Packets

This directory is a local Codex-only review workspace. It is intentionally ignored by git.

Workflow:

1. Assign one packet directory to one Codex chat.
2. In that chat, review the rows from `input.jsonl`.
3. Write one decision per row into `submission.jsonl`.
4. Run `npm run ml:review:ingredient-catalog:merge` to merge completed packets into `ml/review/ingredient_catalog_manual_review.jsonl`.
5. Run:
   - `npm run ml:review:ingredient-catalog`
   - `npm run ml:review:ingredient-catalog:shards`
   - `npm run ml:review:ingredient-catalog:packets:status`

Helpful files:

- Packet manifest: `{manifest_path}`
- Manual review target: `ml/review/ingredient_catalog_manual_review.jsonl`
- Queue CSV: `ml/review/ingredient_catalog_review_queue.csv`

Packet status meanings:

- `pending`: `submission.jsonl` is still empty
- `submitted`: `submission.jsonl` has rows ready to merge
- `merged`: submission has already been merged and archived to `submission.merged.jsonl`
"""


def ensure_output_dir_ready(output_dir: Path, clean: bool) -> None:
    if output_dir.exists():
        if clean:
            shutil.rmtree(output_dir)
        elif any(output_dir.iterdir()):
            raise SystemExit(
                f"Packets directory already exists and is not empty: {output_dir}. "
                "Merge current submissions or rerun with --clean."
            )
    output_dir.mkdir(parents=True, exist_ok=True)


def main() -> int:
    args = parse_args()
    queue_file = Path(args.queue_file)
    seed_file = Path(args.seed_file)
    output_dir = Path(args.output_dir)
    ensure_output_dir_ready(output_dir, args.clean)

    queue_rows = read_csv_rows(queue_file)
    seed_map = read_seed_map(seed_file)

    lane_rows: Dict[str, List[Dict[str, object]]] = defaultdict(list)

    for queue_row in queue_rows:
        if not args.include_reviewed and as_text(queue_row.get("review_status")):
            continue
        normalized_name = as_text(queue_row.get("normalized_name"))
        seed_row = seed_map.get(normalized_name)
        if not seed_row:
            continue

        metadata = seed_row.get("metadata") if isinstance(seed_row.get("metadata"), dict) else {}
        lane = classify_lane(queue_row)
        lane_rows[lane].append(
            {
                "priority_score": int(queue_row.get("priority_score") or 0),
                "lane": lane,
                "normalized_name": normalized_name,
                "canonical_name": as_text(seed_row.get("canonical_name")),
                "lookup_count": int(seed_row.get("lookup_count") or 0),
                "current_allergens": seed_row.get("allergens") if isinstance(seed_row.get("allergens"), list) else [],
                "current_diets": seed_row.get("diets") if isinstance(seed_row.get("diets"), list) else [],
                "current_is_ready": seed_row.get("is_ready") is True,
                "blocked_diets": metadata.get("blocked_diets") if isinstance(metadata.get("blocked_diets"), list) else [],
                "reason_codes": metadata.get("reason_codes") if isinstance(metadata.get("reason_codes"), list) else [],
                "aliases": seed_row.get("aliases") if isinstance(seed_row.get("aliases"), list) else [],
                "surface_forms": metadata.get("surface_forms") if isinstance(metadata.get("surface_forms"), list) else [],
                "datasets": metadata.get("datasets") if isinstance(metadata.get("datasets"), list) else [],
            }
        )

    manifest = {
        "include_reviewed": bool(args.include_reviewed),
        "generated_at": "2026-03-06",
        "output_dir": str(output_dir),
        "total_packets": 0,
        "total_rows": 0,
        "lanes": {},
        "packets": [],
    }

    for lane in sorted(PACKET_SIZES):
        rows = lane_rows.get(lane, [])
        packet_size = PACKET_SIZES[lane]
        lane_dir = output_dir / lane
        lane_dir.mkdir(parents=True, exist_ok=True)
        lane_packet_count = 0

        for index, chunk in enumerate(iter_chunks(rows, packet_size), start=1):
            packet_id = f"{lane}-{index:03d}"
            packet_dir = lane_dir / packet_id
            packet_dir.mkdir(parents=True, exist_ok=True)

            input_path = packet_dir / "input.jsonl"
            prompt_path = packet_dir / "prompt.md"
            submission_path = packet_dir / "submission.jsonl"

            write_jsonl(input_path, list(chunk))
            prompt_path.write_text(
                build_packet_prompt(packet_id, lane, len(chunk), input_path, submission_path),
                encoding="utf-8",
            )
            submission_path.touch(exist_ok=True)

            manifest["packets"].append(
                {
                    "packet_id": packet_id,
                    "lane": lane,
                    "row_count": len(chunk),
                    "input": str(input_path),
                    "prompt": str(prompt_path),
                    "submission": str(submission_path),
                }
            )
            lane_packet_count += 1
            manifest["total_packets"] += 1
            manifest["total_rows"] += len(chunk)

        manifest["lanes"][lane] = {
            "packet_count": lane_packet_count,
            "packet_size": packet_size,
            "row_count": len(rows),
        }

    manifest_path = output_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    (output_dir / "README.md").write_text(build_root_readme(output_dir, manifest_path), encoding="utf-8")
    print(f"Wrote review packets to {output_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
