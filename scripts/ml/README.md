# Clarivore Fast Model Training

This folder contains a low-cost, fast multi-label training pipeline for ingredient text classification:

- `fetch_openfoodfacts_data.py`: automatically gathers real ingredient-label text + allergen/diet tags from Open Food Facts.
- `export_training_data.py`: pulls labeled ingredient text from Supabase and writes JSONL train/val splits.
- `train_fast_model.py`: trains a lightweight hashed-feature PyTorch model for allergen and diet-violation flags.
- `evaluate_model.py`: evaluates a trained run and writes metrics JSON.

## Quick start

```bash
python3 scripts/ml/export_training_data.py
python3 scripts/ml/train_fast_model.py
python3 scripts/ml/evaluate_model.py
```

Online ingestion + train:

```bash
python3 scripts/ml/fetch_openfoodfacts_data.py --max-pages 10 --include-traces
python3 scripts/ml/export_training_data.py \
  --manual-labels scripts/ml/manual_hidden_alias_seed.jsonl \
  --manual-labels ml/data/processed/openfoodfacts_examples.jsonl
python3 scripts/ml/train_fast_model.py
python3 scripts/ml/evaluate_model.py
```

Outputs:

- Processed data: `ml/data/processed/`
- Raw source snapshots: `ml/data/raw/`
- Model artifacts: `ml/artifacts/run-<timestamp>/`

## Notes

- This pipeline is model-first and does not depend on deterministic synonym dictionaries in runtime inference.
- Brand-item diet arrays in current schema represent compatibility labels, not violations, so they are excluded from diet-violation targets.
- Open Food Facts API search has a published rate limit (10 requests/minute). Keep `--throttle-seconds` at ~6+ for large pulls.
