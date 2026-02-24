#!/usr/bin/env python3
import argparse
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Tuple

import torch
import torch.nn as nn
from torch.utils.data import DataLoader

from model_utils import (
    HashedLinearMultilabelModel,
    HashedMultilabelDataset,
    LabelSpace,
    collate_batch,
    compute_pos_weight,
    load_jsonl,
    summarize_metrics,
    write_json,
    write_jsonl,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Train a lightweight Clarivore allergen+diet multi-label model.",
    )
    parser.add_argument("--train-file", default="ml/data/processed/train.jsonl")
    parser.add_argument("--val-file", default="ml/data/processed/val.jsonl")
    parser.add_argument("--label-space-file", default="ml/data/processed/label_space.json")
    parser.add_argument("--artifact-root", default="ml/artifacts")
    parser.add_argument("--feature-dim", type=int, default=32768)
    parser.add_argument("--epochs", type=int, default=40)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--lr", type=float, default=0.05)
    parser.add_argument("--weight-decay", type=float, default=1e-4)
    parser.add_argument("--threshold", type=float, default=0.5)
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--device", default="auto", choices=["auto", "cpu", "mps", "cuda"])
    parser.add_argument("--print-every", type=int, default=1)
    return parser.parse_args()


def pick_device(choice: str) -> str:
    if choice != "auto":
        return choice
    if torch.cuda.is_available():
        return "cuda"
    # embedding_bag is not reliably available on MPS in current local torch builds.
    return "cpu"


def load_label_space(path: Path) -> LabelSpace:
    payload = json.loads(path.read_text(encoding="utf-8"))
    allergens = payload.get("allergens", []) if isinstance(payload, dict) else []
    diets = payload.get("diets", []) if isinstance(payload, dict) else []
    return LabelSpace(
        allergens=[str(value).strip() for value in allergens if str(value).strip()],
        diets=[str(value).strip() for value in diets if str(value).strip()],
    )


def run_epoch(
    model: HashedLinearMultilabelModel,
    loader: DataLoader,
    criterion: nn.Module,
    device: str,
    optimizer: torch.optim.Optimizer = None,
) -> Tuple[float, torch.Tensor, torch.Tensor]:
    is_train = optimizer is not None
    model.train(mode=is_train)

    losses: List[float] = []
    logits_list: List[torch.Tensor] = []
    targets_list: List[torch.Tensor] = []

    for flat_features, offsets, targets in loader:
        flat_features = flat_features.to(device)
        offsets = offsets.to(device)
        targets = targets.to(device)

        logits = model(flat_features, offsets)
        loss = criterion(logits, targets)

        if is_train:
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            optimizer.step()

        losses.append(float(loss.detach().cpu().item()))
        logits_list.append(logits.detach().cpu())
        targets_list.append(targets.detach().cpu())

    average_loss = sum(losses) / len(losses) if losses else 0.0

    if logits_list:
        logits_cat = torch.cat(logits_list, dim=0)
        targets_cat = torch.cat(targets_list, dim=0)
    else:
        logits_cat = torch.zeros((0, model.output_dim), dtype=torch.float32)
        targets_cat = torch.zeros((0, model.output_dim), dtype=torch.float32)

    return average_loss, logits_cat, targets_cat


def score_tuple(metrics: Dict[str, object]) -> Tuple[float, float, float]:
    allergens = metrics.get("allergens", {}) if isinstance(metrics, dict) else {}
    overall = metrics.get("overall", {}) if isinstance(metrics, dict) else {}
    diets = metrics.get("diets", {}) if isinstance(metrics, dict) else {}
    return (
        float(allergens.get("recall", 0.0)),
        float(overall.get("f1", 0.0)),
        float(diets.get("f1", 0.0)),
    )


def main() -> int:
    args = parse_args()

    torch.manual_seed(args.seed)

    train_file = Path(args.train_file)
    val_file = Path(args.val_file)
    label_space_file = Path(args.label_space_file)

    if not train_file.exists() or not label_space_file.exists():
        print("Training inputs missing. Run export script first.")
        return 1

    label_space = load_label_space(label_space_file)
    if label_space.output_dim == 0:
        print("Label space is empty. Cannot train.")
        return 1

    train_rows = load_jsonl(train_file)
    val_rows = load_jsonl(val_file) if val_file.exists() else []

    train_dataset = HashedMultilabelDataset(train_rows, label_space, args.feature_dim)
    val_dataset = HashedMultilabelDataset(val_rows, label_space, args.feature_dim)

    if len(train_dataset) == 0:
        print("No training rows after preprocessing.")
        return 1

    train_loader = DataLoader(
        train_dataset,
        batch_size=max(1, int(args.batch_size)),
        shuffle=True,
        collate_fn=collate_batch,
    )
    val_loader = DataLoader(
        val_dataset,
        batch_size=max(1, int(args.batch_size)),
        shuffle=False,
        collate_fn=collate_batch,
    )

    device = pick_device(args.device)
    model = HashedLinearMultilabelModel(args.feature_dim, label_space.output_dim).to(device)

    pos_weight = compute_pos_weight(train_dataset.target_matrix()).to(device)
    criterion = nn.BCEWithLogitsLoss(pos_weight=pos_weight)

    optimizer = torch.optim.AdamW(
        model.parameters(),
        lr=float(args.lr),
        weight_decay=float(args.weight_decay),
    )

    run_id = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    artifact_dir = Path(args.artifact_root) / f"run-{run_id}"
    artifact_dir.mkdir(parents=True, exist_ok=True)

    history: List[Dict[str, object]] = []
    best_payload: Dict[str, object] = {}
    best_score = (-1.0, -1.0, -1.0)

    for epoch in range(1, int(args.epochs) + 1):
        train_loss, train_logits, train_targets = run_epoch(
            model=model,
            loader=train_loader,
            criterion=criterion,
            device=device,
            optimizer=optimizer,
        )
        train_metrics = summarize_metrics(train_logits, train_targets, label_space, threshold=args.threshold)

        if len(val_dataset) > 0:
            with torch.no_grad():
                val_loss, val_logits, val_targets = run_epoch(
                    model=model,
                    loader=val_loader,
                    criterion=criterion,
                    device=device,
                    optimizer=None,
                )
            val_metrics = summarize_metrics(val_logits, val_targets, label_space, threshold=args.threshold)
        else:
            val_loss = 0.0
            val_metrics = {
                "overall": {"f1": 0.0, "precision": 0.0, "recall": 0.0},
                "allergens": {"f1": 0.0, "precision": 0.0, "recall": 0.0},
                "diets": {"f1": 0.0, "precision": 0.0, "recall": 0.0},
                "allergen_false_negatives": 0,
                "per_label": [],
            }

        epoch_payload = {
            "epoch": epoch,
            "train_loss": train_loss,
            "val_loss": val_loss,
            "train_metrics": train_metrics,
            "val_metrics": val_metrics,
        }
        history.append(epoch_payload)

        current_score = score_tuple(val_metrics if len(val_dataset) else train_metrics)
        if current_score > best_score:
            best_score = current_score
            best_payload = {
                "epoch": epoch,
                "train_loss": train_loss,
                "val_loss": val_loss,
                "train_metrics": train_metrics,
                "val_metrics": val_metrics,
            }
            torch.save(model.state_dict(), artifact_dir / "model.pt")

        if epoch % max(1, int(args.print_every)) == 0:
            allergen_recall = float((val_metrics if len(val_dataset) else train_metrics).get("allergens", {}).get("recall", 0.0))
            overall_f1 = float((val_metrics if len(val_dataset) else train_metrics).get("overall", {}).get("f1", 0.0))
            print(
                f"epoch={epoch:03d} train_loss={train_loss:.4f} val_loss={val_loss:.4f} "
                f"allergen_recall={allergen_recall:.3f} overall_f1={overall_f1:.3f}"
            )

    config_payload = {
        "created_at_utc": datetime.now(timezone.utc).isoformat(),
        "feature_dim": int(args.feature_dim),
        "threshold": float(args.threshold),
        "label_space": {
            "allergens": label_space.allergens,
            "diets": label_space.diets,
        },
        "train_rows": len(train_dataset),
        "val_rows": len(val_dataset),
        "hyperparameters": {
            "epochs": int(args.epochs),
            "batch_size": int(args.batch_size),
            "lr": float(args.lr),
            "weight_decay": float(args.weight_decay),
            "seed": int(args.seed),
            "device": device,
        },
    }

    write_json(artifact_dir / "config.json", config_payload)
    write_json(artifact_dir / "best_metrics.json", best_payload)
    write_jsonl(artifact_dir / "history.jsonl", history)

    # Write a convenience pointer to latest run for eval automation.
    write_json(Path(args.artifact_root) / "latest.json", {"run_dir": str(artifact_dir)})

    print(f"Saved model artifact to: {artifact_dir}")
    if best_payload:
        best_allergen_recall = float(best_payload.get("val_metrics", {}).get("allergens", {}).get("recall", 0.0))
        best_overall_f1 = float(best_payload.get("val_metrics", {}).get("overall", {}).get("f1", 0.0))
        print(
            f"Best epoch={best_payload.get('epoch')} "
            f"val_allergen_recall={best_allergen_recall:.3f} val_overall_f1={best_overall_f1:.3f}"
        )

    return 0


if __name__ == "__main__":
    sys.exit(main())
