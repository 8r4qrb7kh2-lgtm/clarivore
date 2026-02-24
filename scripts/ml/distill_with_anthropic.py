#!/usr/bin/env python3
"""Teacher-student distillation for allergen labels using Anthropic models."""

import argparse
import json
import random
import socket
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Dict, Iterable, List, Sequence, Tuple

import torch
from torch.utils.data import DataLoader

from model_utils import (
    HashedLinearMultilabelModel,
    HashedMultilabelDataset,
    LabelSpace,
    as_text,
    collate_batch,
    load_jsonl,
    write_json,
    write_jsonl,
)


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


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Distill allergen labels from a teacher model (Anthropic).")
    parser.add_argument("--input", default="ml/data/processed/usda_only_train.jsonl")
    parser.add_argument("--output", default="ml/data/processed/usda_teacher_distilled.jsonl")
    parser.add_argument("--summary-output", default="ml/data/processed/usda_teacher_distilled_summary.json")
    parser.add_argument("--artifact-dir", default="", help="Student artifact directory. Defaults to ml/artifacts/latest.json")
    parser.add_argument("--artifact-root", default="ml/artifacts")
    parser.add_argument("--model", default="claude-haiku-4-5-20251001")
    parser.add_argument("--api-key", default="", help="Anthropic API key; defaults to ANTHROPIC_API_KEY.")
    parser.add_argument("--anthropic-version", default="2023-06-01")
    parser.add_argument("--max-examples", type=int, default=1200, help="Number of hard examples to label.")
    parser.add_argument("--candidate-pool", type=int, default=12000, help="Pool size before top-k pick.")
    parser.add_argument("--teacher-batch-size", type=int, default=10)
    parser.add_argument("--max-tokens", type=int, default=2048)
    parser.add_argument("--temperature", type=float, default=0.0)
    parser.add_argument("--min-teacher-confidence", type=float, default=0.65)
    parser.add_argument("--student-threshold", type=float, default=0.5)
    parser.add_argument("--batch-size", type=int, default=512, help="Student inference batch size.")
    parser.add_argument("--device", default="auto", choices=["auto", "cpu", "mps", "cuda"])
    parser.add_argument("--max-retries", type=int, default=5)
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--overwrite", action="store_true", help="Overwrite existing output file.")
    return parser.parse_args()


def resolve_artifact_dir(artifact_dir: str, artifact_root: str) -> Path:
    if artifact_dir:
        return Path(artifact_dir)
    latest_path = Path(artifact_root) / "latest.json"
    if not latest_path.exists():
        raise FileNotFoundError("No --artifact-dir provided and latest.json not found.")
    payload = json.loads(latest_path.read_text(encoding="utf-8"))
    run_dir = as_text(payload.get("run_dir"))
    if not run_dir:
        raise FileNotFoundError("latest.json missing run_dir")
    return Path(run_dir)


def pick_device(choice: str) -> str:
    if choice != "auto":
        return choice
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def _safe_float(value: object, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return float(default)


def _safe_div(num: float, den: float) -> float:
    return float(num) / float(den) if den else 0.0


def clamp01(value: float) -> float:
    return max(0.0, min(1.0, float(value)))


def parse_teacher_json(raw_text: str) -> Dict[str, object]:
    text = as_text(raw_text)
    if not text:
        return {}

    try:
        payload = json.loads(text)
        if isinstance(payload, dict):
            return payload
    except json.JSONDecodeError:
        pass

    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        snippet = text[start : end + 1]
        try:
            payload = json.loads(snippet)
            if isinstance(payload, dict):
                return payload
        except json.JSONDecodeError:
            return {}
    return {}


def call_anthropic(
    api_key: str,
    version: str,
    model: str,
    prompt: str,
    max_tokens: int,
    temperature: float,
    max_retries: int,
) -> Dict[str, object]:
    url = "https://api.anthropic.com/v1/messages"
    payload = {
        "model": model,
        "max_tokens": max(256, int(max_tokens)),
        "temperature": float(max(0.0, temperature)),
        "system": (
            "You are a precise food-allergen labeling expert. "
            "Return strict JSON only."
        ),
        "messages": [{"role": "user", "content": prompt}],
    }
    body = json.dumps(payload).encode("utf-8")
    headers = {
        "x-api-key": api_key,
        "anthropic-version": version,
        "content-type": "application/json",
        "accept": "application/json",
    }

    last_error: Exception = RuntimeError("Unknown Anthropic error")
    for attempt in range(1, max(1, int(max_retries)) + 1):
        request = urllib.request.Request(url, data=body, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                result = json.loads(response.read().decode("utf-8"))
                if isinstance(result, dict):
                    return result
                raise RuntimeError("Unexpected response payload shape")
        except (
            urllib.error.HTTPError,
            urllib.error.URLError,
            TimeoutError,
            socket.timeout,
            json.JSONDecodeError,
        ) as error:
            last_error = error
            if attempt >= max(1, int(max_retries)):
                break
            sleep_seconds = min(20.0, (2 ** (attempt - 1)) + random.random())
            print(f"[warn] teacher API failed ({attempt}/{max_retries}): {error}; retry {sleep_seconds:.1f}s")
            time.sleep(sleep_seconds)
    raise RuntimeError(f"Anthropic request failed after retries: {last_error}")


def extract_content_text(payload: Dict[str, object]) -> str:
    parts = payload.get("content", [])
    if not isinstance(parts, list):
        return ""
    out: List[str] = []
    for part in parts:
        if not isinstance(part, dict):
            continue
        text = as_text(part.get("text"))
        if text:
            out.append(text)
    return "\n".join(out).strip()


def stable_unique(values: Iterable[str]) -> List[str]:
    seen = set()
    out: List[str] = []
    for value in values:
        safe = as_text(value)
        if not safe or safe in seen:
            continue
        seen.add(safe)
        out.append(safe)
    return out


def build_teacher_prompt(batch_rows: Sequence[Dict[str, object]]) -> str:
    payload_rows = []
    for row in batch_rows:
        payload_rows.append(
            {
                "id": as_text(row.get("id")),
                "ingredients": as_text(row.get("text")),
            }
        )

    return (
        "Label allergens present in each ingredient list.\n"
        f"Allowed labels: {ALLOWED_ALLERGENS}\n"
        "Rules:\n"
        "- Use only ingredient semantics; do not infer from undeclared risk statements.\n"
        "- Plant milk compounds (e.g., coconut milk, almond milk, soy milk, oat milk) are not dairy milk.\n"
        "- Coconut should map to 'tree nut' in this schema.\n"
        "- Return JSON only in this schema:\n"
        "{\"items\":[{\"id\":\"...\",\"allergens\":[\"...\"],\"confidence\":0.0}]}\n"
        "Confidence must be 0..1.\n"
        f"Inputs:\n{json.dumps(payload_rows, ensure_ascii=False)}"
    )


def build_student_candidates(
    rows: Sequence[Dict[str, object]],
    artifact_dir: Path,
    device: str,
    batch_size: int,
    threshold: float,
) -> List[Dict[str, object]]:
    config_path = artifact_dir / "config.json"
    model_path = artifact_dir / "model.pt"
    if not config_path.exists() or not model_path.exists():
        raise FileNotFoundError(f"Incomplete student artifact in {artifact_dir}")

    config = json.loads(config_path.read_text(encoding="utf-8"))
    model_cfg = config.get("model", {}) if isinstance(config, dict) else {}
    labels = config.get("label_space", {}) if isinstance(config, dict) else {}
    label_space = LabelSpace(
        allergens=[as_text(v) for v in labels.get("allergens", []) if as_text(v)],
        diets=[as_text(v) for v in labels.get("diets", []) if as_text(v)],
    )
    feature_dim = int(config.get("feature_dim", 32768))

    filtered_rows = [row for row in rows if as_text(row.get("text"))]
    dataset = HashedMultilabelDataset(filtered_rows, label_space, feature_dim)
    if len(dataset) == 0:
        return []

    loader = DataLoader(
        dataset,
        batch_size=max(1, int(batch_size)),
        shuffle=False,
        collate_fn=collate_batch,
    )
    model = HashedLinearMultilabelModel(
        feature_dim,
        label_space.output_dim,
        mode=as_text(model_cfg.get("mode")) or "linear",
        embed_dim=int(model_cfg.get("embed_dim", 256)),
        hidden_dim=int(model_cfg.get("hidden_dim", 256)),
        dropout=float(model_cfg.get("dropout", 0.15)),
        bag_mode=as_text(model_cfg.get("bag_mode")) or "sum",
    ).to(device)
    model.load_state_dict(torch.load(model_path, map_location=device))
    model.eval()

    all_probs: List[torch.Tensor] = []
    with torch.no_grad():
        for flat_features, offsets, _ in loader:
            logits = model(flat_features.to(device), offsets.to(device))
            all_probs.append(torch.sigmoid(logits).cpu())

    probs = torch.cat(all_probs, dim=0)
    allergen_dim = len(label_space.allergens)
    threshold = clamp01(threshold)

    out: List[Dict[str, object]] = []
    for index, row in enumerate(filtered_rows):
        row_probs = probs[index][:allergen_dim]
        weak = {as_text(v) for v in row.get("allergens", []) or [] if as_text(v)}

        mean_margin = float(torch.mean(torch.abs(row_probs - 0.5)).item())
        uncertainty = clamp01(1.0 - (2.0 * mean_margin))

        predicted = set()
        for label_index, label in enumerate(label_space.allergens):
            if float(row_probs[label_index].item()) >= threshold:
                predicted.add(label)

        mismatch = len(predicted.symmetric_difference(weak))
        mismatch_rate = _safe_div(float(mismatch), float(max(1, allergen_dim)))
        score = (0.65 * uncertainty) + (0.35 * mismatch_rate)

        out.append(
            {
                "id": as_text(row.get("id")),
                "text": as_text(row.get("text")),
                "weak_allergens": sorted(weak),
                "student_predicted": sorted(predicted),
                "student_uncertainty": float(uncertainty),
                "student_mismatch_rate": float(mismatch_rate),
                "distill_score": float(score),
            }
        )
    return out


def load_existing_distilled_ids(path: Path) -> Dict[str, Dict[str, object]]:
    if not path.exists():
        return {}
    rows = load_jsonl(path)
    out: Dict[str, Dict[str, object]] = {}
    for row in rows:
        row_id = as_text(row.get("id"))
        if row_id:
            out[row_id] = row
    return out


def main() -> int:
    args = parse_args()
    random.seed(args.seed)

    api_key = as_text(args.api_key) or as_text(__import__("os").environ.get("ANTHROPIC_API_KEY"))
    if not api_key:
        print("Missing Anthropic API key. Set ANTHROPIC_API_KEY or pass --api-key.")
        return 1

    input_path = Path(args.input)
    if not input_path.exists():
        print(f"Input dataset not found: {input_path}")
        return 1

    output_path = Path(args.output)
    summary_path = Path(args.summary_output)

    existing: Dict[str, Dict[str, object]] = {}
    if output_path.exists() and not args.overwrite:
        existing = load_existing_distilled_ids(output_path)
        print(f"[info] resuming from existing distilled rows: {len(existing)}")

    rows = load_jsonl(input_path)
    artifact_dir = resolve_artifact_dir(args.artifact_dir, args.artifact_root)
    device = pick_device(args.device)

    candidates = build_student_candidates(
        rows=rows,
        artifact_dir=artifact_dir,
        device=device,
        batch_size=args.batch_size,
        threshold=args.student_threshold,
    )
    if not candidates:
        print("No candidates generated.")
        return 1

    candidates.sort(key=lambda row: row["distill_score"], reverse=True)
    pool_size = min(len(candidates), max(1, int(args.candidate_pool)))
    top_pool = candidates[:pool_size]
    selected = top_pool[: min(max(1, int(args.max_examples)), len(top_pool))]

    if existing:
        selected = [row for row in selected if as_text(row.get("id")) not in existing]

    if not selected:
        print("No new examples selected after resume filter.")
        write_json(
            summary_path,
            {
                "input_rows": len(rows),
                "candidate_rows": len(candidates),
                "selected_rows": 0,
                "new_rows_written": 0,
                "total_output_rows": len(existing),
                "resume_mode": bool(existing),
                "artifact_dir": str(artifact_dir),
                "teacher_model": args.model,
            },
        )
        return 0

    total_calls = 0
    parse_failures = 0
    api_failures = 0
    accepted = 0
    rejected_low_conf = 0
    rejected_empty = 0

    distilled_rows: List[Dict[str, object]] = list(existing.values())
    batch_size = max(1, int(args.teacher_batch_size))

    for start in range(0, len(selected), batch_size):
        batch = selected[start : start + batch_size]
        prompt = build_teacher_prompt(batch)

        try:
            response = call_anthropic(
                api_key=api_key,
                version=args.anthropic_version,
                model=args.model,
                prompt=prompt,
                max_tokens=args.max_tokens,
                temperature=args.temperature,
                max_retries=args.max_retries,
            )
        except RuntimeError as error:
            api_failures += 1
            print(f"[warn] teacher call failed for batch {start // batch_size + 1}: {error}")
            continue

        total_calls += 1
        content_text = extract_content_text(response)
        parsed = parse_teacher_json(content_text)
        items = parsed.get("items", []) if isinstance(parsed, dict) else []
        if not isinstance(items, list):
            items = []

        by_id: Dict[str, Dict[str, object]] = {}
        for item in items:
            if not isinstance(item, dict):
                continue
            item_id = as_text(item.get("id"))
            if not item_id:
                continue
            by_id[item_id] = item

        if not by_id:
            parse_failures += 1
            print(f"[warn] teacher JSON parse empty for batch {start // batch_size + 1}")
            continue

        for row in batch:
            row_id = as_text(row.get("id"))
            teacher_item = by_id.get(row_id)
            if teacher_item is None:
                continue

            teacher_allergens = stable_unique(teacher_item.get("allergens", []) or [])
            teacher_allergens = [label for label in teacher_allergens if label in ALLOWED_ALLERGENS]
            teacher_conf = clamp01(_safe_float(teacher_item.get("confidence"), 0.0))

            if not teacher_allergens:
                rejected_empty += 1
                continue
            if teacher_conf < float(args.min_teacher_confidence):
                rejected_low_conf += 1
                continue

            distilled_rows.append(
                {
                    "id": row_id,
                    "text": as_text(row.get("text")),
                    "allergens": teacher_allergens,
                    "diets": [],
                    "source": "teacher_distilled_anthropic",
                    "meta": {
                        "teacher_model": args.model,
                        "teacher_confidence": teacher_conf,
                        "student_uncertainty": float(row.get("student_uncertainty", 0.0)),
                        "student_mismatch_rate": float(row.get("student_mismatch_rate", 0.0)),
                        "weak_allergens": row.get("weak_allergens", []),
                        "student_predicted": row.get("student_predicted", []),
                    },
                }
            )
            accepted += 1

        if (start // batch_size + 1) % 5 == 0:
            print(
                f"[distill] batch={start // batch_size + 1} "
                f"processed={min(start + batch_size, len(selected))}/{len(selected)} accepted={accepted}"
            )

    # Deduplicate output by ID; keep highest teacher confidence.
    dedup: Dict[str, Dict[str, object]] = {}
    for row in distilled_rows:
        row_id = as_text(row.get("id"))
        if not row_id:
            continue
        confidence = _safe_float((row.get("meta", {}) or {}).get("teacher_confidence"), 0.0)
        existing_row = dedup.get(row_id)
        existing_conf = _safe_float(((existing_row or {}).get("meta", {}) or {}).get("teacher_confidence"), -1.0)
        if existing_row is None or confidence >= existing_conf:
            dedup[row_id] = row

    final_rows = list(dedup.values())
    final_rows.sort(key=lambda row: as_text(row.get("id")))

    write_jsonl(output_path, final_rows)
    summary = {
        "input_rows": len(rows),
        "candidate_rows": len(candidates),
        "selected_rows": len(selected),
        "api_calls": total_calls,
        "api_failures": api_failures,
        "parse_failures": parse_failures,
        "accepted_rows": accepted,
        "rejected_low_confidence": rejected_low_conf,
        "rejected_empty_allergens": rejected_empty,
        "total_output_rows": len(final_rows),
        "artifact_dir": str(artifact_dir),
        "teacher_model": args.model,
        "min_teacher_confidence": float(args.min_teacher_confidence),
    }
    write_json(summary_path, summary)
    print(f"Wrote distilled rows -> {output_path} ({len(final_rows)})")
    print(f"Summary -> {summary_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
