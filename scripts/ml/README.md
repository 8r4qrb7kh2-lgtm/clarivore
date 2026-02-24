# Clarivore Fast Model Training

This folder contains a low-cost, fast multi-label training pipeline for ingredient text classification:

- `fetch_openfoodfacts_data.py`: automatically gathers real ingredient-label text + allergen/diet tags from Open Food Facts.
- `fetch_openfoodfacts_targeted.py`: high-yield allergen-tag harvesting from Open Food Facts (balanced positives by allergen class).
- `fetch_usda_fdc_data.py`: fetches USDA Branded ingredient labels and extracts high-confidence allergen labels from explicit contains/may-contain statements.
- `fetch_usda_fdc_bulk.py`: downloads USDA Branded CSV ZIP and generates large-scale train/holdout JSONL from real branded labels.
- `export_training_data.py`: pulls labeled ingredient text from Supabase and writes JSONL train/val splits.
- `train_fast_model.py`: trains a lightweight hashed-feature PyTorch model for allergen and diet-violation flags.
- `evaluate_model.py`: evaluates a trained run and writes metrics JSON.
- `tune_thresholds.py`: sweeps decision thresholds and recommends recall-priority vs F1-priority operating points.

## Quick start

```bash
python3 scripts/ml/export_training_data.py
python3 scripts/ml/train_fast_model.py
python3 scripts/ml/evaluate_model.py
python3 scripts/ml/tune_thresholds.py
# Evaluate using tuned per-label thresholds:
# python3 scripts/ml/evaluate_model.py --threshold-file ml/artifacts/run-*/threshold_tuning.json
```

Online ingestion + train:

```bash
python3 scripts/ml/fetch_openfoodfacts_data.py --max-pages 10 --include-traces
python3 scripts/ml/fetch_openfoodfacts_targeted.py --pages-per-tag 6 --include-traces
python3 scripts/ml/fetch_usda_fdc_data.py --max-pages 40 --page-size 200
python3 scripts/ml/export_training_data.py \
  --manual-labels scripts/ml/manual_hidden_alias_seed.jsonl \
  --manual-labels ml/data/processed/openfoodfacts_examples.jsonl \
  --manual-labels ml/data/processed/openfoodfacts_targeted_examples.jsonl \
  --manual-labels ml/data/processed/usda_fdc_examples.jsonl
python3 scripts/ml/train_fast_model.py
python3 scripts/ml/evaluate_model.py
python3 scripts/ml/tune_thresholds.py
```

USDA bulk ingestion + external holdout validation:

```bash
python3 scripts/ml/fetch_usda_fdc_bulk.py --require-contains
python3 scripts/ml/export_training_data.py \
  --manual-labels scripts/ml/manual_hidden_alias_seed.jsonl \
  --manual-labels ml/data/processed/openfoodfacts_targeted_examples.jsonl \
  --manual-labels ml/data/processed/usda_fdc_bulk_train_examples.jsonl
python3 scripts/ml/train_fast_model.py
python3 scripts/ml/tune_thresholds.py
python3 scripts/ml/evaluate_model.py \
  --dataset ml/data/processed/usda_fdc_bulk_holdout_examples.jsonl
```

Outputs:

- Processed data: `ml/data/processed/`
- Raw source snapshots: `ml/data/raw/`
- Model artifacts: `ml/artifacts/run-<timestamp>/`

## Notes

- This pipeline is model-first and does not depend on deterministic synonym dictionaries in runtime inference.
- Brand-item diet arrays in current schema represent compatibility labels, not violations, so they are excluded from diet-violation targets.
- Open Food Facts API search has a published rate limit (10 requests/minute). Keep `--throttle-seconds` at ~6+ for large pulls.
- USDA `DEMO_KEY` is heavily rate-limited. Set `USDA_API_KEY` for large-scale pulls.
- USDA bulk CSV download avoids API throttling and is preferable for large-scale training/validation.
