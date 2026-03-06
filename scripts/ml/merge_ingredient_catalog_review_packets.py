#!/usr/bin/env python3
"""Merge packet-level Codex review submissions into the master manual review file."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Dict, List, Set


DEFAULT_PACKETS_DIR = "ml/review/packets"
DEFAULT_OUTPUT_FILE = "ml/review/ingredient_catalog_manual_review.jsonl"
DEFAULT_SEED_FILE = "ml/seeds/ingredient_catalog_seed.jsonl"
ALLOWED_STATUSES = {"verified", "corrected", "verified_fallback"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Merge ingredient catalog review packet submissions.")
    parser.add_argument("--packets-dir", default=DEFAULT_PACKETS_DIR)
    parser.add_argument("--output-file", default=DEFAULT_OUTPUT_FILE)
    parser.add_argument("--seed-file", default=DEFAULT_SEED_FILE)
    parser.add_argument(
        "--keep-submissions",
        action="store_true",
        help="Leave submission.jsonl files in place after merging instead of archiving them.",
    )
    return parser.parse_args()


def as_text(value: object) -> str:
    return str(value or "").strip()


def read_jsonl(path: Path) -> List[Dict[str, object]]:
    rows: List[Dict[str, object]] = []
    if not path.exists():
        return rows
    with path.open("r", encoding="utf-8") as handle:
        for raw_line in handle:
            line = raw_line.strip()
            if not line:
                continue
            payload = json.loads(line)
            if isinstance(payload, dict):
                rows.append(payload)
    return rows


def write_jsonl(path: Path, rows: List[Dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False))
            handle.write("\n")


def read_seed_names(path: Path) -> Set[str]:
    return {
        as_text(row.get("normalized_name"))
        for row in read_jsonl(path)
        if as_text(row.get("normalized_name"))
    }


def validate_submission(row: Dict[str, object], seed_names: Set[str], source: Path) -> Dict[str, object]:
    normalized_name = as_text(row.get("normalized_name"))
    if not normalized_name:
        raise ValueError(f"{source}: submission row missing normalized_name")
    if normalized_name not in seed_names:
        raise ValueError(f"{source}: unknown normalized_name {normalized_name}")

    status = as_text(row.get("status"))
    if status not in ALLOWED_STATUSES:
        raise ValueError(f"{source}: invalid status for {normalized_name}: {status}")

    notes = as_text(row.get("notes"))
    if not notes:
        raise ValueError(f"{source}: missing notes for {normalized_name}")

    normalized = {
        "normalized_name": normalized_name,
        "status": status,
        "notes": notes,
        "reviewer": as_text(row.get("reviewer")) or "codex",
        "reviewed_at": as_text(row.get("reviewed_at")) or "2026-03-06",
    }

    if status == "verified_fallback":
        normalized["is_ready"] = False

    if "allergens" in row:
        if not isinstance(row.get("allergens"), list):
            raise ValueError(f"{source}: allergens must be a list for {normalized_name}")
        normalized["allergens"] = [as_text(item) for item in row["allergens"] if as_text(item)]

    if "diets" in row:
        if not isinstance(row.get("diets"), list):
            raise ValueError(f"{source}: diets must be a list for {normalized_name}")
        normalized["diets"] = [as_text(item) for item in row["diets"] if as_text(item)]

    if "is_ready" in row:
        if not isinstance(row.get("is_ready"), bool):
            raise ValueError(f"{source}: is_ready must be boolean for {normalized_name}")
        normalized["is_ready"] = row["is_ready"]

    if status == "corrected" and not any(key in normalized for key in ("allergens", "diets", "is_ready")):
        raise ValueError(f"{source}: corrected row for {normalized_name} must change allergens, diets, or is_ready")

    return normalized


def main() -> int:
    args = parse_args()
    packets_dir = Path(args.packets_dir)
    output_file = Path(args.output_file)
    seed_names = read_seed_names(Path(args.seed_file))
    if not packets_dir.exists():
        raise FileNotFoundError(f"Packets directory not found: {packets_dir}")

    existing_rows = read_jsonl(output_file)
    merged_map = {
        as_text(row.get("normalized_name")): row
        for row in existing_rows
        if as_text(row.get("normalized_name"))
    }
    ordered_names = [as_text(row.get("normalized_name")) for row in existing_rows if as_text(row.get("normalized_name"))]

    seen_packet_names: Set[str] = set()
    submission_files = sorted(packets_dir.glob("**/submission.jsonl"))
    merged_count = 0
    merged_files = 0

    for submission_file in submission_files:
        submission_rows = read_jsonl(submission_file)
        if not submission_rows:
            continue

        for raw_row in submission_rows:
            row = validate_submission(raw_row, seed_names, submission_file)
            normalized_name = row["normalized_name"]
            if normalized_name in seen_packet_names:
                raise ValueError(f"duplicate packet submission for {normalized_name}")
            seen_packet_names.add(normalized_name)
            if normalized_name not in merged_map:
                ordered_names.append(normalized_name)
            merged_map[normalized_name] = row
            merged_count += 1

        merged_files += 1
        if not args.keep_submissions:
            archived_path = submission_file.with_name("submission.merged.jsonl")
            if archived_path.exists():
                archived_path.unlink()
            submission_file.replace(archived_path)

    final_rows = [merged_map[name] for name in ordered_names]
    write_jsonl(output_file, final_rows)
    print(
        f"Merged {merged_count} packet review rows from {merged_files} packet files into {output_file}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
