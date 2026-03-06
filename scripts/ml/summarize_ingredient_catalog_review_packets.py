#!/usr/bin/env python3
"""Summarize the local packetized ingredient catalog review workspace."""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path
from typing import Dict, List


DEFAULT_PACKETS_DIR = "ml/review/packets"
DEFAULT_OUTPUT_FILE = "ml/review/packets/status.json"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Summarize ingredient catalog review packet status.")
    parser.add_argument("--packets-dir", default=DEFAULT_PACKETS_DIR)
    parser.add_argument("--output-file", default=DEFAULT_OUTPUT_FILE)
    return parser.parse_args()


def nonempty_line_count(path: Path) -> int:
    if not path.exists():
        return 0
    count = 0
    with path.open("r", encoding="utf-8") as handle:
        for raw_line in handle:
            if raw_line.strip():
                count += 1
    return count


def packet_status(packet_dir: Path) -> str:
    merged_path = packet_dir / "submission.merged.jsonl"
    if nonempty_line_count(merged_path) > 0:
        return "merged"

    submission_path = packet_dir / "submission.jsonl"
    if nonempty_line_count(submission_path) > 0:
        return "submitted"

    return "pending"


def main() -> int:
    args = parse_args()
    packets_dir = Path(args.packets_dir)
    output_file = Path(args.output_file)

    if not packets_dir.exists():
        raise FileNotFoundError(f"Packets directory not found: {packets_dir}")

    packets: List[Dict[str, object]] = []
    lane_summary: Dict[str, Dict[str, int]] = defaultdict(
        lambda: {
            "packets_total": 0,
            "rows_total": 0,
            "pending_packets": 0,
            "submitted_packets": 0,
            "merged_packets": 0,
        }
    )

    for lane_dir in sorted(path for path in packets_dir.iterdir() if path.is_dir()):
        lane = lane_dir.name
        for packet_dir in sorted(path for path in lane_dir.iterdir() if path.is_dir()):
            row_count = nonempty_line_count(packet_dir / "input.jsonl")
            status = packet_status(packet_dir)
            packets.append(
                {
                    "packet_id": packet_dir.name,
                    "lane": lane,
                    "row_count": row_count,
                    "status": status,
                    "path": str(packet_dir),
                }
            )
            lane_summary[lane]["packets_total"] += 1
            lane_summary[lane]["rows_total"] += row_count
            lane_summary[lane][f"{status}_packets"] += 1

    summary = {
        "packets_dir": str(packets_dir),
        "total_packets": len(packets),
        "total_rows": sum(int(packet["row_count"]) for packet in packets),
        "pending_packets": sum(1 for packet in packets if packet["status"] == "pending"),
        "submitted_packets": sum(1 for packet in packets if packet["status"] == "submitted"),
        "merged_packets": sum(1 for packet in packets if packet["status"] == "merged"),
        "lanes": dict(sorted(lane_summary.items())),
        "packets": packets,
    }

    output_file.parent.mkdir(parents=True, exist_ok=True)
    output_file.write_text(json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    print(f"Wrote packet status to {output_file}")
    print(
        "Packets:"
        f" total={summary['total_packets']}"
        f" pending={summary['pending_packets']}"
        f" submitted={summary['submitted_packets']}"
        f" merged={summary['merged_packets']}"
    )
    for lane, lane_row in summary["lanes"].items():
        print(
            f"{lane}:"
            f" packets={lane_row['packets_total']}"
            f" rows={lane_row['rows_total']}"
            f" pending={lane_row['pending_packets']}"
            f" submitted={lane_row['submitted_packets']}"
            f" merged={lane_row['merged_packets']}"
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
