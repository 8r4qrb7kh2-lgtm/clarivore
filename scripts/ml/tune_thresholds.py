#!/usr/bin/env python3
"""Tune decision thresholds for trained Clarivore multilabel model."""

import argparse
import json
import math
from pathlib import Path
from typing import Dict, List, Tuple

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
    parser = argparse.ArgumentParser(description="Tune classification thresholds for allergen recall.")
    parser.add_argument("--dataset", default="ml/data/processed/val.jsonl")
    parser.add_argument("--artifact-dir", default="", help="Run dir with model.pt/config.json")
    parser.add_argument("--artifact-root", default="ml/artifacts")
    parser.add_argument("--batch-size", type=int, default=128)
    parser.add_argument("--min-threshold", type=float, default=0.05)
    parser.add_argument("--max-threshold", type=float, default=0.95)
    parser.add_argument("--steps", type=int, default=19)
    parser.add_argument("--allergen-recall-target", type=float, default=0.97)
    parser.add_argument("--per-label", action="store_true", help="Also tune per-label thresholds.")
    parser.add_argument("--device", default="auto", choices=["auto", "cpu", "mps", "cuda"])
    return parser.parse_args()


def pick_device(choice: str) -> str:
    if choice != "auto":
        return choice
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def resolve_artifact_dir(args: argparse.Namespace) -> Path:
    if args.artifact_dir:
        return Path(args.artifact_dir)
    latest_path = Path(args.artifact_root) / "latest.json"
    if not latest_path.exists():
        raise FileNotFoundError("No --artifact-dir provided and latest.json missing.")
    payload = json.loads(latest_path.read_text(encoding="utf-8"))
    run_dir = payload.get("run_dir")
    if not run_dir:
        raise FileNotFoundError("latest.json missing run_dir")
    return Path(run_dir)


def load_model_and_data(args: argparse.Namespace):
    artifact_dir = resolve_artifact_dir(args)
    config_path = artifact_dir / "config.json"
    model_path = artifact_dir / "model.pt"
    if not config_path.exists() or not model_path.exists():
        raise FileNotFoundError(f"Incomplete artifact in {artifact_dir}")

    config = json.loads(config_path.read_text(encoding="utf-8"))
    model_config = config.get("model", {}) if isinstance(config, dict) else {}
    label_space = LabelSpace(
        allergens=[str(v).strip() for v in config.get("label_space", {}).get("allergens", []) if str(v).strip()],
        diets=[str(v).strip() for v in config.get("label_space", {}).get("diets", []) if str(v).strip()],
    )
    feature_dim = int(config.get("feature_dim", 32768))

    rows = load_jsonl(Path(args.dataset))
    dataset = HashedMultilabelDataset(rows, label_space, feature_dim)
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

    logits_parts = []
    targets_parts = []
    with torch.no_grad():
        for flat_features, offsets, targets in loader:
            logits = model(flat_features.to(device), offsets.to(device))
            logits_parts.append(logits.cpu())
            targets_parts.append(targets.cpu())

    logits = torch.cat(logits_parts, dim=0) if logits_parts else torch.zeros((0, label_space.output_dim), dtype=torch.float32)
    targets = torch.cat(targets_parts, dim=0) if targets_parts else torch.zeros((0, label_space.output_dim), dtype=torch.float32)

    return artifact_dir, label_space, logits, targets


def threshold_grid(min_threshold: float, max_threshold: float, steps: int) -> List[float]:
    if steps <= 1:
        return [min_threshold]
    lo = max(0.0, min(1.0, float(min_threshold)))
    hi = max(0.0, min(1.0, float(max_threshold)))
    if hi < lo:
        lo, hi = hi, lo
    return [lo + ((hi - lo) * index / (steps - 1)) for index in range(steps)]


def score_recall_priority(metrics: Dict[str, object]) -> Tuple[float, float, float]:
    allergens = metrics.get("allergens", {}) if isinstance(metrics, dict) else {}
    overall = metrics.get("overall", {}) if isinstance(metrics, dict) else {}
    return (
        float(allergens.get("recall", 0.0)),
        float(allergens.get("precision", 0.0)),
        float(overall.get("f1", 0.0)),
    )


def score_f1_priority(metrics: Dict[str, object]) -> Tuple[float, float, float]:
    overall = metrics.get("overall", {}) if isinstance(metrics, dict) else {}
    allergens = metrics.get("allergens", {}) if isinstance(metrics, dict) else {}
    return (
        float(overall.get("f1", 0.0)),
        float(allergens.get("recall", 0.0)),
        float(allergens.get("precision", 0.0)),
    )


def tune_per_label_thresholds(
    logits: torch.Tensor,
    targets: torch.Tensor,
    label_space: LabelSpace,
    min_threshold: float,
    max_threshold: float,
    steps: int,
    allergen_recall_target: float,
) -> Dict[str, object]:
    probs = torch.sigmoid(logits)
    thresholds = threshold_grid(min_threshold, max_threshold, steps)
    labels = label_space.allergens + label_space.diets
    allergen_count = len(label_space.allergens)

    tuned_values: List[float] = []
    per_label_rows: List[Dict[str, object]] = []

    for index, label in enumerate(labels):
        target_vec = (targets[:, index] >= 0.5)
        support = int(target_vec.sum().item())
        label_type = "allergen" if index < allergen_count else "diet"

        if support <= 0:
            tuned_values.append(1.0)
            per_label_rows.append(
                {
                    "label": label,
                    "type": label_type,
                    "support": 0,
                    "threshold": 1.0,
                    "precision": 0.0,
                    "recall": 0.0,
                    "tp": 0,
                    "fp": 0,
                    "fn": 0,
                    "note": "No positives in validation; threshold pinned to 1.0",
                }
            )
            continue

        recall_target = float(allergen_recall_target) if label_type == "allergen" else 0.9

        best_with_target = None
        best_fallback = None

        for threshold in thresholds:
            pred_vec = probs[:, index] >= float(threshold)

            tp = int((pred_vec & target_vec).sum().item())
            fp = int((pred_vec & ~target_vec).sum().item())
            fn = int((~pred_vec & target_vec).sum().item())
            precision = float(tp) / float(tp + fp) if (tp + fp) else 0.0
            recall = float(tp) / float(tp + fn) if (tp + fn) else 0.0
            payload = {
                "threshold": float(threshold),
                "precision": precision,
                "recall": recall,
                "tp": tp,
                "fp": fp,
                "fn": fn,
            }

            fallback_score = (recall, precision, float(threshold))
            if best_fallback is None or fallback_score > best_fallback[0]:
                best_fallback = (fallback_score, payload)

            if recall >= recall_target:
                target_score = (precision, float(threshold))
                if best_with_target is None or target_score > best_with_target[0]:
                    best_with_target = (target_score, payload)

        chosen = best_with_target[1] if best_with_target is not None else best_fallback[1]
        tuned_values.append(float(chosen["threshold"]))
        per_label_rows.append(
            {
                "label": label,
                "type": label_type,
                "support": support,
                "threshold": float(chosen["threshold"]),
                "precision": float(chosen["precision"]),
                "recall": float(chosen["recall"]),
                "tp": int(chosen["tp"]),
                "fp": int(chosen["fp"]),
                "fn": int(chosen["fn"]),
            }
        )

    tuned_metrics = summarize_metrics(logits, targets, label_space, threshold=tuned_values)
    return {
        "thresholds": tuned_values,
        "per_label": per_label_rows,
        "metrics": tuned_metrics,
    }


def main() -> int:
    args = parse_args()
    artifact_dir, label_space, logits, targets = load_model_and_data(args)

    grid = threshold_grid(args.min_threshold, args.max_threshold, args.steps)

    rows = []
    best_recall = {"threshold": None, "metrics": None, "score": (-1.0, -1.0, -1.0)}
    best_f1 = {"threshold": None, "metrics": None, "score": (-1.0, -1.0, -1.0)}

    for threshold in grid:
        metrics = summarize_metrics(logits, targets, label_space, threshold=threshold)
        rows.append({"threshold": threshold, "metrics": metrics})

        recall_score = score_recall_priority(metrics)
        if recall_score > best_recall["score"]:
            best_recall = {"threshold": threshold, "metrics": metrics, "score": recall_score}

        f1_score = score_f1_priority(metrics)
        if f1_score > best_f1["score"]:
            best_f1 = {"threshold": threshold, "metrics": metrics, "score": f1_score}

    payload = {
        "dataset": str(Path(args.dataset)),
        "grid": {"min": args.min_threshold, "max": args.max_threshold, "steps": args.steps},
        "best_recall_priority": {
            "threshold": best_recall["threshold"],
            "metrics": best_recall["metrics"],
        },
        "best_f1_priority": {
            "threshold": best_f1["threshold"],
            "metrics": best_f1["metrics"],
        },
        "sweep": rows,
    }

    if args.per_label:
        payload["per_label_threshold_recall_priority"] = tune_per_label_thresholds(
            logits=logits,
            targets=targets,
            label_space=label_space,
            min_threshold=args.min_threshold,
            max_threshold=args.max_threshold,
            steps=max(25, args.steps),
            allergen_recall_target=args.allergen_recall_target,
        )

    out_path = artifact_dir / "threshold_tuning.json"
    write_json(out_path, payload)

    rec = best_recall["metrics"]["allergens"] if best_recall["metrics"] else {}
    print(
        "best_recall_priority",
        f"threshold={best_recall['threshold']:.3f}",
        f"allergen_recall={float(rec.get('recall', 0.0)):.3f}",
        f"allergen_precision={float(rec.get('precision', 0.0)):.3f}",
    )

    f1m = best_f1["metrics"]["overall"] if best_f1["metrics"] else {}
    print(
        "best_f1_priority",
        f"threshold={best_f1['threshold']:.3f}",
        f"overall_f1={float(f1m.get('f1', 0.0)):.3f}",
    )
    if args.per_label and "per_label_threshold_recall_priority" in payload:
        prm = payload["per_label_threshold_recall_priority"]["metrics"]["allergens"]
        print(
            "per_label_recall_priority",
            f"allergen_recall={float(prm.get('recall', 0.0)):.3f}",
            f"allergen_precision={float(prm.get('precision', 0.0)):.3f}",
        )
    print(f"Saved threshold tuning report: {out_path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
