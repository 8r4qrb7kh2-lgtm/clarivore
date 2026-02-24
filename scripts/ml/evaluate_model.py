#!/usr/bin/env python3
import argparse
import json
import sys
from pathlib import Path
from typing import Dict

import torch
from torch.utils.data import DataLoader

from model_utils import (
    HashedLinearMultilabelModel,
    HashedMultilabelDataset,
    LabelSpace,
    collate_batch,
    load_jsonl,
    summarize_metrics,
    write_json,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Evaluate a trained Clarivore model on a JSONL dataset.")
    parser.add_argument("--dataset", default="ml/data/processed/val.jsonl")
    parser.add_argument("--artifact-dir", default="", help="Path to run dir (contains model.pt/config.json).")
    parser.add_argument("--artifact-root", default="ml/artifacts", help="Fallback root used with latest.json.")
    parser.add_argument("--batch-size", type=int, default=64)
    parser.add_argument("--threshold", type=float, default=-1.0, help="Override decision threshold (0..1).")
    parser.add_argument(
        "--threshold-file",
        default="",
        help="JSON file with per-label thresholds (from tune_thresholds.py).",
    )
    parser.add_argument("--device", default="auto", choices=["auto", "cpu", "mps", "cuda"])
    return parser.parse_args()


def pick_device(choice: str) -> str:
    if choice != "auto":
        return choice
    if torch.cuda.is_available():
        return "cuda"
    # embedding_bag is not reliably available on MPS in current local torch builds.
    return "cpu"


def resolve_artifact_dir(args: argparse.Namespace) -> Path:
    if args.artifact_dir:
        return Path(args.artifact_dir)

    latest_path = Path(args.artifact_root) / "latest.json"
    if not latest_path.exists():
        raise FileNotFoundError("No --artifact-dir provided and latest.json not found.")

    payload = json.loads(latest_path.read_text(encoding="utf-8"))
    run_dir = payload.get("run_dir")
    if not run_dir:
        raise FileNotFoundError("latest.json is missing run_dir")
    return Path(run_dir)


def main() -> int:
    args = parse_args()
    dataset_path = Path(args.dataset)
    if not dataset_path.exists():
        print(f"Dataset file not found: {dataset_path}")
        return 1

    artifact_dir = resolve_artifact_dir(args)
    config_path = artifact_dir / "config.json"
    model_path = artifact_dir / "model.pt"

    if not config_path.exists() or not model_path.exists():
        print(f"Model artifact incomplete in {artifact_dir}")
        return 1

    config = json.loads(config_path.read_text(encoding="utf-8"))
    labels = config.get("label_space", {}) if isinstance(config, dict) else {}
    model_config = config.get("model", {}) if isinstance(config, dict) else {}

    label_space = LabelSpace(
        allergens=[str(v).strip() for v in labels.get("allergens", []) if str(v).strip()],
        diets=[str(v).strip() for v in labels.get("diets", []) if str(v).strip()],
    )

    feature_dim = int(config.get("feature_dim", 32768))
    threshold: object = float(config.get("threshold", 0.5))
    if args.threshold >= 0.0:
        threshold = max(0.0, min(1.0, float(args.threshold)))
    elif args.threshold_file:
        threshold_payload = json.loads(Path(args.threshold_file).read_text(encoding="utf-8"))
        per_label = threshold_payload.get("per_label_threshold_recall_priority", {})
        values = per_label.get("thresholds", [])
        if isinstance(values, list) and len(values) == label_space.output_dim:
            threshold = [float(value) for value in values]

    rows = load_jsonl(dataset_path)
    dataset = HashedMultilabelDataset(rows, label_space, feature_dim)

    if len(dataset) == 0:
        print("Dataset is empty after preprocessing.")
        return 1

    loader = DataLoader(dataset, batch_size=max(1, int(args.batch_size)), shuffle=False, collate_fn=collate_batch)

    device = pick_device(args.device)
    model = HashedLinearMultilabelModel(
        feature_dim,
        label_space.output_dim,
        mode=str(model_config.get("mode", "linear")),
        embed_dim=int(model_config.get("embed_dim", 256)),
        hidden_dim=int(model_config.get("hidden_dim", 256)),
        dropout=float(model_config.get("dropout", 0.15)),
        bag_mode=str(model_config.get("bag_mode", "sum")),
    ).to(device)
    model.load_state_dict(torch.load(model_path, map_location=device))
    model.eval()

    all_logits = []
    all_targets = []

    with torch.no_grad():
        for flat_features, offsets, targets in loader:
            logits = model(flat_features.to(device), offsets.to(device))
            all_logits.append(logits.cpu())
            all_targets.append(targets.cpu())

    logits_cat = torch.cat(all_logits, dim=0)
    targets_cat = torch.cat(all_targets, dim=0)

    metrics: Dict[str, object] = summarize_metrics(logits_cat, targets_cat, label_space, threshold=threshold)
    metrics_payload = {
        "artifact_dir": str(artifact_dir),
        "dataset": str(dataset_path),
        "rows": len(dataset),
        "threshold": threshold if isinstance(threshold, (int, float)) else "per_label_from_file",
        "threshold_file": args.threshold_file or "",
        "metrics": metrics,
    }

    out_path = artifact_dir / f"eval-{dataset_path.stem}.json"
    write_json(out_path, metrics_payload)

    overall = metrics.get("overall", {})
    allergens = metrics.get("allergens", {})
    print(
        f"rows={len(dataset)} "
        f"overall_f1={float(overall.get('f1', 0.0)):.3f} "
        f"allergen_recall={float(allergens.get('recall', 0.0)):.3f} "
        f"allergen_fn={int(metrics.get('allergen_false_negatives', 0))}"
    )
    print(f"Saved evaluation report: {out_path}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
