"""إعادة استخدام حساب بداية البرومبت (KV cache) بين الطلبات، فوق MLX.

كل طلب للمساعد يبدأ بنفس البرومبت الثابت (أكثر من 2000 توكن) ثم اللقطة ثم السؤال. بدون هذا يُحسب البرومبت كاملاً من الصفر مع كل رسالة.
هنا نحتفظ بآخر برومبتات محسوبة (slots)، ونأخذ أطول بداية مشتركة مع البرومبت الجديد، ونحسب الباقي فقط.
الفكرة من نسخة الفريق (application/llm.py) لكن بالمطابقة على مستوى التوكنات، فتنفع أي بداية مشتركة وليس البرومبت الثابت فقط.
أي خطأ من اختلاف نسخ MLX يوقف الكاش ويرجع للتوليد العادي بنفس النتيجة."""
import traceback

import mlx.core as mx
from mlx_lm import stream_generate
from mlx_lm.models.cache import can_trim_prompt_cache, make_prompt_cache, trim_prompt_cache


def encode(tokenizer, prompt):
    # نفس ترميز stream_generate للنص
    add = tokenizer.bos_token is None or not prompt.startswith(tokenizer.bos_token)
    return tokenizer.encode(prompt, add_special_tokens=add)


def _shared(a, b):
    n, i = min(len(a), len(b)), 0
    while i < n and a[i] == b[i]:
        i += 1
    return i


KEEP_WHOLE = 32    # إذا الاختلاف في آخر 32 توكن أو أقل (نهاية البرومبت قبل الرد) نكمل على نفس الكاش بدل نسخه


class PromptCache:
    def __init__(self, model, tokenizer, slots=2):
        self.model, self.tokenizer, self.size = model, tokenizer, max(0, slots)
        self.slots = []                    # [(tokens, cache)]، الأحدث آخراً
        self.on = self.size > 0
        self.last_reused = 0               # كم توكن أُعيد استخدامه في آخر طلب (للفحص والسجل)

    def _take(self, ids):
        best, best_len = None, 0
        for slot in self.slots:
            n = _shared(slot[0], ids)
            if n > best_len:
                best, best_len = slot, n
        best_len = min(best_len, len(ids) - 1)   # لازم يبقى توكن واحد على الأقل يُحسب
        if best is None or best_len <= 0 or not can_trim_prompt_cache(best[1]):
            del self.slots[:len(self.slots) - self.size + 1]   # مكان للكاش الجديد ضمن الحد
            return make_prompt_cache(self.model), 0
        if self.size < 2 or len(best[0]) - best_len <= KEEP_WHOLE:
            # نفس المحادثة امتدت: نكمل على نفس الكاش
            self.slots.remove(best)
            cache = best[1]
        else:
            # بنية مختلفة (مثلاً نداء الأداة ونداء الجواب): ننسخ البداية ونبقي الأصل لطلبات بنيته
            self.slots = [best]
            cache = make_prompt_cache(self.model)
            for dst, src in zip(cache, best[1]):
                dst.state = tuple(mx.array(a) if isinstance(a, mx.array) else a for a in src.state)
        trim_prompt_cache(cache, len(best[0]) - best_len)
        return cache, best_len

    def _keep(self, cache, ids):
        # الكاش فيه البرومبت + ما تولّد؛ نرجعه لطول البرومبت فقط
        extra = cache[0].offset - len(ids)
        if extra > 0:
            trim_prompt_cache(cache, extra)
        if cache[0].offset == len(ids):
            self.slots.append((ids, cache))
            del self.slots[:-self.size]

    def generate(self, ids, **kwargs):
        """مثل stream_generate بالضبط، مع إعادة استخدام البداية المحسوبة. ids: توكنات البرومبت كاملة."""
        self.last_reused = 0
        if self.on:
            try:
                cache, start = self._take(ids)
                parts = stream_generate(self.model, self.tokenizer, prompt=mx.array(ids[start:]), prompt_cache=cache, **kwargs)
                first = next(parts, None)
            except Exception:
                traceback.print_exc()
                print('[serve-mlx] prompt cache off: falling back to plain generation', flush=True)
                self.on, self.slots = False, []
            else:
                self.last_reused = start
                if first is not None:
                    yield first
                    yield from parts
                self._keep(cache, ids)
                return
        yield from stream_generate(self.model, self.tokenizer, prompt=mx.array(ids), **kwargs)
