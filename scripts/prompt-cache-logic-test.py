"""منطق كاش البرومبت (mlx_prompt_cache.py) بدون MLX ولا أوزان: نموذج وهمي ناتجه يعتمد على كل التوكنات السابقة،
فأي خطأ في إعادة الاستخدام أو القص يغيّر النص. للفحص الحقيقي على النموذج: prompt-cache-check.py داخل WSL."""
import hashlib
import sys
import types

core = types.ModuleType('mlx.core')
core.array = type('array', (list,), {})
mlx = types.ModuleType('mlx')
mlx.core = core
fail = {'on': False}


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


class Part:
    def __init__(self, text):
        self.text, self.finish_reason = text, None


def stream_generate(model, tokenizer, prompt, prompt_cache=None, **_):
    if fail['on'] and prompt_cache is not None:
        raise RuntimeError('simulated MLX difference')
    cache = prompt_cache or [KV()]
    cache[0].tokens += list(prompt)
    for _ in range(3):
        h = int(hashlib.md5(str(cache[0].tokens).encode()).hexdigest(), 16) % 97
        yield Part(f'<{h}>')
        cache[0].tokens.append(1000 + h)


def trim(cache, n):
    if n > 0:
        del cache[0].tokens[-n:]
    return n


lm = types.ModuleType('mlx_lm')
lm.stream_generate = stream_generate
models = types.ModuleType('mlx_lm.models')
cache_mod = types.ModuleType('mlx_lm.models.cache')
cache_mod.make_prompt_cache = lambda model: [KV()]
cache_mod.can_trim_prompt_cache = lambda cache: True
cache_mod.trim_prompt_cache = trim
sys.modules.update({'mlx': mlx, 'mlx.core': core, 'mlx_lm': lm, 'mlx_lm.models': models, 'mlx_lm.models.cache': cache_mod})

from mlx_prompt_cache import PromptCache  # noqa: E402


def plain(ids):
    return ''.join(p.text for p in stream_generate(None, None, prompt=ids))


def run(pc, ids):
    return ''.join(p.text for p in pc.generate(ids))


# بنية طلبات المساعد: نداء أول (برومبت + أدوات + لقطة + سؤال) ونداء ثانٍ بعد الأداة (برومبت + لقطة + ... بدون أدوات)
S, T, snap = list(range(2000)), list(range(3000, 3300)), list(range(5000, 6500))
c1, c2 = S + T + snap + [1, 2, 3], S + snap + [1, 2, 3, 9, 9]
m2c1, m2c2 = S + T + snap + [1, 2, 3, 4, 5, 6], S + snap + [1, 2, 3, 4, 5, 6, 9]
pc = PromptCache(None, None, 2)
reused = []
for ids in (c1, c2, m2c1, m2c2, m2c1 + [7]):
    assert run(pc, ids) == plain(ids)
    reused.append(pc.last_reused)
    assert len(pc.slots) <= 2
assert reused == [0, 2000, 3803, 3503, 3806], reused
gen = pc.generate(c2)
next(gen)
gen.close()                                   # انقطع الاتصال أثناء التوليد: لا يُحفظ كاش ناقص
assert run(pc, c2) == plain(c2)
one = PromptCache(None, None, 1)
for ids in (c1, c2, m2c1, m2c2):
    assert run(one, ids) == plain(ids) and len(one.slots) <= 1
assert run(PromptCache(None, None, 0), c1) == plain(c1)
fail['on'] = True
assert run(pc, c1) == plain(c1) and pc.on is False   # خطأ من MLX: يرجع للتوليد العادي بنفس النتيجة
print('All prompt cache logic checks passed')
