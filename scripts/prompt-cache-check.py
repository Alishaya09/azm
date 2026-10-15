"""فحص كاش البرومبت على النموذج الحقيقي داخل WSL (بدون تشغيل الموقع):
يولّد نفس الأسئلة مرة بالتوليد العادي ومرة بالكاش، ويتأكد أن النص متطابق، ويطبع الوقت وعدد التوكنات المعاد استخدامها.
الاستخدام: python -B scripts/prompt-cache-check.py --model ~/azm-llm/models/qwen3-4b-4bit
أوقف serve-mlx.py قبله إذا الذاكرة ما تكفي نسختين."""
import argparse
import re
import time
from pathlib import Path

import mlx.core as mx
from mlx_lm import load, stream_generate
from mlx_lm.sample_utils import make_sampler

from mlx_prompt_cache import PromptCache, encode

parser = argparse.ArgumentParser()
parser.add_argument('--model', required=True)
parser.add_argument('--prefill-step', type=int, default=256)
args = parser.parse_args()
model, tokenizer = load(args.model)
source = (Path(__file__).resolve().parent.parent / 'server/ai/prompt.mjs').read_text(encoding='utf-8')
system = re.search(r'SYSTEM_PROMPT = `(.*?)`;', source, re.S).group(1)
snapshot = 'Current operational snapshot (JSON):\n{"viewer":{"role":"admin"},"units":[{"name":"الوحدة الأولى","stockPercent":{"diesel":62.5,"water":18}}]}'
tools = [{'type': 'function', 'function': {'name': 'read_inventory', 'description': 'Read stock of one entity', 'parameters': {'type': 'object', 'properties': {'entityId': {'type': 'string'}}}}}]


def prompt(history, with_tools):
    messages = [{'role': 'system', 'content': system}, {'role': 'system', 'content': snapshot}, *history]
    return encode(tokenizer, tokenizer.apply_chat_template(messages, tools=tools if with_tools else None, tokenize=False,
                                                           add_generation_prompt=True, enable_thinking=False))


def options():
    return dict(max_tokens=60, sampler=make_sampler(temp=0), prefill_step_size=args.prefill_step)


def plain(ids):
    start = time.perf_counter()
    text = ''.join(p.text for p in stream_generate(model, tokenizer, prompt=mx.array(ids), **options()))
    return text, time.perf_counter() - start


cache = PromptCache(model, tokenizer, 2)
turns = [
    ([{'role': 'user', 'content': 'كم الديزل في الوحدة الأولى؟'}], True),
    ([{'role': 'user', 'content': 'كم الديزل في الوحدة الأولى؟'}], False),
    ([{'role': 'user', 'content': 'كم الديزل في الوحدة الأولى؟'}, {'role': 'assistant', 'content': 'الديزل 62.5%.'},
      {'role': 'user', 'content': 'والماء؟'}], True),
]
same = True
for i, (history, with_tools) in enumerate(turns, 1):
    ids = prompt(history, with_tools)
    expected, t_plain = plain(ids)
    start = time.perf_counter()
    got = ''.join(p.text for p in cache.generate(ids, **options()))
    t_cache = time.perf_counter() - start
    ok = got == expected
    same &= ok
    print(f'{i}: {len(ids)} tokens, reused {cache.last_reused}, plain {t_plain:.1f}s, cached {t_cache:.1f}s, {"same" if ok else "DIFFERENT"}')
    if not ok:
        print('   plain :', expected[:200])
        print('   cached:', got[:200])
print('PASS: cached output is identical' if same else 'CHECK: outputs differ; run serve-mlx.py with --prompt-cache-slots 0')
