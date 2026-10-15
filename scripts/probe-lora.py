"""اختبار استخراج حقيقي اختياري داخل بيئة MLX الموجودة؛ لا يعدّل الأوزان."""
import argparse
import json
from mlx_lm import load, generate
from mlx_lm.sample_utils import make_sampler

parser = argparse.ArgumentParser()
parser.add_argument('--model', required=True)
parser.add_argument('--adapter', required=True)
args = parser.parse_args()
model, tokenizer = load(args.model, adapter_path=args.adapter)
print('ADAPTER_LOADED', flush=True)
question = 'نبغى 12 برميل ديزل و5 علب زيت محرك، الأولوية عاجلة.'
cases = [
    ('user_only', [{'role': 'user', 'content': question}]),
    ('schema', [{'role': 'system', 'content': 'Extract a supply request into JSON only: {"items":[{"item":"canonical English name","supply_class":"class","quantity":number or null,"unit_of_measure":"canonical unit or null"}],"priority":"normal, high, urgent or null","deadline":"English deadline or null"}. Never invent missing quantities. diesel and engine oil are class III. برميل = barrel; علبة زيت = can. عاجل = urgent.'}, {'role': 'user', 'content': question}]),
]
for name, messages in cases:
    prompt = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True, enable_thinking=False)
    answer = generate(model, tokenizer, prompt=prompt, max_tokens=400, sampler=make_sampler(temp=0), verbose=False)
    try:
        value = json.loads(answer)
        expected = [('diesel', 'III', 12, 'barrel'), ('engine oil', 'III', 5, 'can')]
        actual = [(i.get('item'), i.get('supply_class'), i.get('quantity'), i.get('unit_of_measure')) for i in value.get('items', [])]
        valid = set(value) == {'items','priority','deadline'} and actual == expected and value.get('priority') == 'urgent' and value.get('deadline') is None
    except (ValueError, TypeError, AttributeError):
        valid = False
    print(json.dumps({'case': name, 'input': question, 'output': answer, 'matches_expected': valid}, ensure_ascii=False), flush=True)
