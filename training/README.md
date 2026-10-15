# Training the request-extraction model (QLoRA)

## Goal

Teach Qwen3-4B to turn a supply request, written in everyday Arabic or English, into structured JSON with a fixed format.

## Data

- **Files:**
  - `data/train.jsonl`: 1600 training examples.
  - `data/valid.jsonl`: 200 examples the model never trained on (used for evaluation).
- **Languages and styles:** 75% Arabic (dialect, formal, lists) and 25% English (casual, formal, lists).
- **System prompt:** every example carries the exact same system prompt as the server (`REQUEST_SYSTEM_PROMPT` in `server/ai/request-contract.mjs`). **Do not change one without the other.**
- **Not in the repository:** the 200-request test split and 30 harder test requests used during training (4.5% → 94.5% exact match on test, 80% on the harder set).
- **Format:** mlx-lm chat, `{"id", "lang", "style", "messages": [system, user, assistant]}`.

Example (shortened):

```json
{"id": "val-0001", "lang": "en", "style": "en_casual",
 "messages": [{"role": "system", "content": "You are a military logistics request parser. ..."},
              {"role": "user", "content": "1st Platoon here, requesting resupply of 70 sacks of IV fluid, high priority"},
              {"role": "assistant", "content": "{\"items\": [{\"item\": \"IV saline\", \"supply_class\": \"VIII\", \"quantity\": 70, \"unit_of_measure\": \"bag\"}], \"priority\": \"high\", \"deadline\": null}"}]}
```

## Settings

| Setting | Value |
|---|---|
| Base model | `mlx-community/Qwen3-4B-4bit` |
| Method | QLoRA (LoRA on the 4-bit quantized model) |
| Rank / scale / dropout | 16 / 2.0 / 0.05 |
| Layers | 16 |
| Iterations | 800 |
| Batch size | 4 |
| Learning rate | 1e-4 (Adam) |
| Max sequence length | 1024 |
| `mask_prompt` | true (learns from the answer only) |
| Seed | 42 |
| Output | 59MB (`adapters.safetensors`) |

These values come from `models/request-adapter/adapter_config.json`, the file mlx-lm saved during training.

## Training command (mlx-lm)

```bash
mlx_lm.lora -c training/lora_config.yaml
```

`training/lora_config.yaml` holds the settings above. The adapter is written to `models/request-adapter/`.

## Evaluation

```bash
node scripts/eval-extraction.mjs            # fine-tuned vs base model on valid.jsonl
node scripts/eval-extraction.mjs --guards   # + what reaches the user after the server guardrails
```

The result is written to `eval-results/report.md`.

## Using the adapter

`scripts/start-ai.sh` loads the adapter from `models/request-adapter/` and serves it as `azm-request-lora`.
The adapter is published on the **Releases** page, not in git.
