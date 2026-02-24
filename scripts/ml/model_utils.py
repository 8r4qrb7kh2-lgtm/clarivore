import hashlib
import json
import math
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Sequence, Tuple

import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import Dataset

TOKEN_RE = re.compile(r"[a-z0-9]+")


def as_text(value: object) -> str:
    return str(value or "").strip()


def load_jsonl(path: Path) -> List[Dict[str, object]]:
    rows: List[Dict[str, object]] = []
    with path.open("r", encoding="utf-8") as handle:
        for raw_line in handle:
            line = raw_line.strip()
            if not line:
                continue
            rows.append(json.loads(line))
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


def tokenize(text: str) -> List[str]:
    return TOKEN_RE.findall(as_text(text).lower())


def _hash_feature(value: str, feature_dim: int) -> int:
    digest = hashlib.blake2b(value.encode("utf-8"), digest_size=8).hexdigest()
    return int(digest, 16) % max(2, int(feature_dim))


def extract_feature_indices(text: str, feature_dim: int) -> List[int]:
    tokens = tokenize(text)
    features = set()

    for token in tokens:
        features.add(f"w:{token}")

    for index in range(len(tokens) - 1):
        features.add(f"b:{tokens[index]}_{tokens[index + 1]}")

    for token in tokens:
        if len(token) < 3:
            continue
        padded = f"^{token}$"
        max_n = min(5, len(padded))
        for n in range(3, max_n + 1):
            for start in range(0, len(padded) - n + 1):
                features.add(f"c:{padded[start:start + n]}")

    if not features:
        return [0]

    hashed = sorted({_hash_feature(feature, feature_dim) for feature in features})
    return hashed or [0]


@dataclass
class LabelSpace:
    allergens: List[str]
    diets: List[str]

    @property
    def output_dim(self) -> int:
        return len(self.allergens) + len(self.diets)

    @property
    def allergen_to_index(self) -> Dict[str, int]:
        return {label: index for index, label in enumerate(self.allergens)}

    @property
    def diet_to_index(self) -> Dict[str, int]:
        start = len(self.allergens)
        return {label: start + index for index, label in enumerate(self.diets)}


class HashedMultilabelDataset(Dataset):
    def __init__(self, rows: Sequence[Dict[str, object]], label_space: LabelSpace, feature_dim: int):
        self.feature_dim = int(feature_dim)
        self.label_space = label_space
        self._samples: List[Tuple[List[int], torch.Tensor]] = []

        allergen_to_index = label_space.allergen_to_index
        diet_to_index = label_space.diet_to_index
        output_dim = label_space.output_dim

        for row in rows:
            text = as_text(row.get("text"))
            if not text:
                continue

            target = torch.zeros(output_dim, dtype=torch.float32)

            for allergen in row.get("allergens", []) or []:
                safe = as_text(allergen)
                if safe in allergen_to_index:
                    target[allergen_to_index[safe]] = 1.0

            for diet in row.get("diets", []) or []:
                safe = as_text(diet)
                if safe in diet_to_index:
                    target[diet_to_index[safe]] = 1.0

            features = extract_feature_indices(text, self.feature_dim)
            self._samples.append((features, target))

    def __len__(self) -> int:
        return len(self._samples)

    def __getitem__(self, index: int) -> Tuple[List[int], torch.Tensor]:
        return self._samples[index]

    def target_matrix(self) -> torch.Tensor:
        if not self._samples:
            return torch.zeros((0, self.label_space.output_dim), dtype=torch.float32)
        return torch.stack([sample[1] for sample in self._samples], dim=0)


def collate_batch(batch: Sequence[Tuple[List[int], torch.Tensor]]) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
    flat_features: List[int] = []
    offsets: List[int] = []
    targets: List[torch.Tensor] = []
    cursor = 0

    for features, target in batch:
        offsets.append(cursor)
        flat_features.extend(features)
        cursor += len(features)
        targets.append(target)

    if not flat_features:
        flat_features = [0]
        offsets = [0]

    return (
        torch.tensor(flat_features, dtype=torch.long),
        torch.tensor(offsets, dtype=torch.long),
        torch.stack(targets, dim=0) if targets else torch.zeros((0, 0), dtype=torch.float32),
    )


class HashedLinearMultilabelModel(nn.Module):
    def __init__(self, feature_dim: int, output_dim: int):
        super().__init__()
        self.feature_dim = int(feature_dim)
        self.output_dim = int(output_dim)
        self.embedding = nn.Embedding(self.feature_dim, self.output_dim)
        self.bias = nn.Parameter(torch.zeros(self.output_dim))
        nn.init.xavier_uniform_(self.embedding.weight)

    def forward(self, flat_features: torch.Tensor, offsets: torch.Tensor) -> torch.Tensor:
        logits = F.embedding_bag(
            input=flat_features,
            weight=self.embedding.weight,
            offsets=offsets,
            mode="sum",
            include_last_offset=False,
        )
        return logits + self.bias


def compute_pos_weight(targets: torch.Tensor, clamp_max: float = 15.0) -> torch.Tensor:
    if targets.numel() == 0:
        return torch.ones((targets.shape[1] if targets.ndim == 2 else 0,), dtype=torch.float32)

    positives = targets.sum(dim=0)
    total = torch.tensor(float(targets.shape[0]), dtype=torch.float32)
    negatives = total - positives

    pos_weight = torch.ones_like(positives)
    mask = positives > 0
    pos_weight[mask] = torch.clamp(negatives[mask] / positives[mask], min=1.0, max=clamp_max)
    return pos_weight


def _safe_div(num: float, den: float) -> float:
    return float(num) / float(den) if den else 0.0


def _f1(precision: float, recall: float) -> float:
    return _safe_div(2.0 * precision * recall, precision + recall)


def summarize_metrics(
    logits: torch.Tensor,
    targets: torch.Tensor,
    label_space: LabelSpace,
    threshold: float = 0.5,
) -> Dict[str, object]:
    if targets.numel() == 0:
        empty_head = {"precision": 0.0, "recall": 0.0, "f1": 0.0, "tp": 0, "fp": 0, "fn": 0, "support": 0}
        return {
            "overall": empty_head,
            "allergens": empty_head,
            "diets": empty_head,
            "per_label": [],
            "allergen_false_negatives": 0,
        }

    probs = torch.sigmoid(logits)
    preds = probs >= float(threshold)
    targets_bool = targets >= 0.5

    tp = (preds & targets_bool).sum(dim=0)
    fp = (preds & ~targets_bool).sum(dim=0)
    fn = (~preds & targets_bool).sum(dim=0)

    def aggregate(start: int, end: int) -> Dict[str, object]:
        if start >= end:
            return {"precision": 0.0, "recall": 0.0, "f1": 0.0, "tp": 0, "fp": 0, "fn": 0, "support": 0}
        tp_sum = int(tp[start:end].sum().item())
        fp_sum = int(fp[start:end].sum().item())
        fn_sum = int(fn[start:end].sum().item())
        support = tp_sum + fn_sum
        precision = _safe_div(tp_sum, tp_sum + fp_sum)
        recall = _safe_div(tp_sum, tp_sum + fn_sum)
        return {
            "precision": precision,
            "recall": recall,
            "f1": _f1(precision, recall),
            "tp": tp_sum,
            "fp": fp_sum,
            "fn": fn_sum,
            "support": support,
        }

    allergen_count = len(label_space.allergens)
    total_count = label_space.output_dim

    per_label = []
    for index, label in enumerate(label_space.allergens + label_space.diets):
        label_tp = int(tp[index].item())
        label_fp = int(fp[index].item())
        label_fn = int(fn[index].item())
        precision = _safe_div(label_tp, label_tp + label_fp)
        recall = _safe_div(label_tp, label_tp + label_fn)
        per_label.append(
            {
                "label": label,
                "type": "allergen" if index < allergen_count else "diet",
                "precision": precision,
                "recall": recall,
                "f1": _f1(precision, recall),
                "tp": label_tp,
                "fp": label_fp,
                "fn": label_fn,
                "support": label_tp + label_fn,
            }
        )

    return {
        "overall": aggregate(0, total_count),
        "allergens": aggregate(0, allergen_count),
        "diets": aggregate(allergen_count, total_count),
        "per_label": per_label,
        "allergen_false_negatives": int(fn[:allergen_count].sum().item()),
    }


def flatten_rows(rows: Iterable[Dict[str, object]]) -> List[Dict[str, object]]:
    out: List[Dict[str, object]] = []
    for row in rows:
        text = as_text(row.get("text"))
        if not text:
            continue
        out.append(
            {
                "id": as_text(row.get("id")),
                "text": text,
                "allergens": sorted({as_text(value) for value in row.get("allergens", []) if as_text(value)}),
                "diets": sorted({as_text(value) for value in row.get("diets", []) if as_text(value)}),
                "source": as_text(row.get("source")),
                "meta": row.get("meta", {}),
            }
        )
    return out
