"""خدمة النموذج الواحد باسمين (serve-mlx.py --base-name) بدون MLX ولا أوزان:
نموذج وهمي يكتب في رده قيمة scale لطبقة LoRA، فنتأكد أن اسم الاستخراج يفعّل الأدابتر واسم المساعد يعطّله، وأن الأسماء الأخرى مرفوضة."""
import json
import socket
import sys
import threading
import time
import types
import urllib.error
import urllib.request
from pathlib import Path

core = types.ModuleType('mlx.core')
core.array = type('array', (list,), {})
core.clear_cache = lambda: None
mlx = types.ModuleType('mlx')
mlx.core = core


class Lora:
    def __init__(self):
        self.lora_a, self.scale = [0], 2.0


class KV:
    def __init__(self):
        self.tokens = []

    @property
    def offset(self):
        return len(self.tokens)

    @property
    def state(self):
        return (core.array(self.tokens),)

    @state.setter
    def state(self, value):
        self.tokens = list(value[0])


class Model:
    layers = [Lora(), Lora()]

    def named_modules(self):
        return [('model', self), *[(f'layers.{i}', m) for i, m in enumerate(self.layers)]]


class Tokenizer:
    bos_token = None

    def apply_chat_template(self, messages, **_):
        return json.dumps(messages, ensure_ascii=False)

    def encode(self, text, **_):
        return [ord(c) for c in text]


class Part:
    def __init__(self, text):
        self.text, self.finish_reason = text, None


def stream_generate(model, tokenizer, prompt, prompt_cache=None, **_):
    cache = prompt_cache or [KV()]
    cache[0].tokens += list(prompt)
    yield Part(f'scale={model.layers[0].scale},{model.layers[1].scale}')


def trim(cache, n):
    if n > 0:
        del cache[0].tokens[-n:]
    return n


lm = types.ModuleType('mlx_lm')
lm.load = lambda path, adapter_path=None: (Model(), Tokenizer())
lm.stream_generate = stream_generate
sample = types.ModuleType('mlx_lm.sample_utils')
sample.make_sampler = lambda temp=0: None
models = types.ModuleType('mlx_lm.models')
cache_mod = types.ModuleType('mlx_lm.models.cache')
cache_mod.make_prompt_cache = lambda model: [KV()]
cache_mod.can_trim_prompt_cache = lambda cache: True
cache_mod.trim_prompt_cache = trim
sys.modules.update({'mlx': mlx, 'mlx.core': core, 'mlx_lm': lm, 'mlx_lm.sample_utils': sample, 'mlx_lm.models': models,
                    'mlx_lm.models.cache': cache_mod})

with socket.socket() as s:
    s.bind(('127.0.0.1', 0))
    port = s.getsockname()[1]
here = Path(__file__).resolve().parent
sys.path.insert(0, str(here))
sys.argv = ['serve-mlx.py', '--model', 'fake', '--adapter', 'fake-adapter', '--name', 'azm-request-lora',
            '--base-name', 'azm-report-base', '--port', str(port)]
code = compile((here / 'serve-mlx.py').read_text(encoding='utf-8'), 'serve-mlx.py', 'exec')
threading.Thread(target=exec, args=(code, {'__name__': '__main__'}), daemon=True).start()


def post(model, stream=False):
    body = json.dumps({'model': model, 'messages': [{'role': 'user', 'content': 'نبي ديزل'}], 'stream': stream}).encode()
    req = urllib.request.Request(f'http://127.0.0.1:{port}/v1/chat/completions', body, {'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=5) as r:
        raw = r.read().decode()
    if not stream:
        return json.loads(raw)['choices'][0]['message']['content']
    return ''.join(json.loads(line[5:])['choices'][0]['delta'].get('content', '') for line in raw.splitlines()
                   if line.startswith('data: {'))


for _ in range(50):
    try:
        listed = json.loads(urllib.request.urlopen(f'http://127.0.0.1:{port}/v1/models', timeout=1).read())
        break
    except OSError:
        time.sleep(0.1)
assert [m['id'] for m in listed['data']] == ['azm-request-lora', 'azm-report-base'], listed
assert post('azm-request-lora') == 'scale=2.0,2.0'
assert post('azm-report-base') == 'scale=0.0,0.0'
assert post('azm-report-base', stream=True) == 'scale=0.0,0.0'
assert post('azm-request-lora', stream=True) == 'scale=2.0,2.0'
assert post('azm-report-base') == 'scale=0.0,0.0'
try:
    post('other-model')
    raise AssertionError('unknown model accepted')
except urllib.error.HTTPError as e:
    assert e.code == 400
print('All serve-mlx name checks passed (one model: request LoRA on, base name LoRA off, unknown names rejected)')
