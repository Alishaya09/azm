"""خدمة محلية اختيارية فوق MLX الموجود. التطبيق نفسه يبقى Node بلا اعتماديات."""
import argparse
import json
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, HTTPServer
import mlx.core as mx
from mlx_lm import load
from mlx_lm.sample_utils import make_sampler
from mlx_protocol import parse_tool_calls
from mlx_prompt_cache import PromptCache, encode

parser = argparse.ArgumentParser()
parser.add_argument('--model', required=True)
parser.add_argument('--adapter')
parser.add_argument('--name', default='azm-request-lora')
parser.add_argument('--port', type=int, default=8001)
# على بطاقة 8GB: برومبت 7200 توكن بلغ ذروة 4.9GB ونجح، و8100 نفدت معه الذاكرة؛ 6144 يترك هامشاً لتوليد الرد
parser.add_argument('--max-context', type=int, default=6144)
parser.add_argument('--idle-timeout', type=int, default=0)
# معالجة البرومبت على دفعات صغيرة: الافتراضي في MLX (2048) يرفع الذروة لنحو 6.8GB مع برومبت 2500 توكن فتنفد ذاكرة بطاقة 8GB
parser.add_argument('--prefill-step', type=int, default=256)
# عدد البرومبتات المحسوبة المحفوظة لإعادة استخدام بدايتها (mlx_prompt_cache.py). 2 = نداء الأداة ونداء الجواب. 0 = إيقاف.
# كل واحد يحجز حتى ~0.9GB عند 6144 توكن؛ إذا نفدت الذاكرة على بطاقة 8GB استخدم 1.
parser.add_argument('--prompt-cache-slots', type=int, default=2)
# اسم ثانٍ لنفس النموذج بدون الأدابتر: نسخة وحدة في الذاكرة تخدم الاستخراج (--name) والمساعد والتقارير (--base-name).
# مع اسم الأساس تُعطَّل طبقات LoRA مؤقتاً (scale = 0) فيكون الناتج هو النموذج الأساسي نفسه. يحتاج --adapter.
parser.add_argument('--base-name')
args = parser.parse_args()
if args.base_name and not args.adapter:
    parser.error('--base-name needs --adapter')
model, tokenizer = load(args.model, adapter_path=args.adapter)
lock = threading.Lock()
loras = [m for _, m in model.named_modules() if hasattr(m, 'lora_a') and hasattr(m, 'scale')]
scales = [m.scale for m in loras]
names = {args.name: True, **({args.base_name: False} if args.base_name else {})}   # الاسم ← هل الأدابتر مفعّل
# كاش برومبت لكل اسم: حساب البرومبت يختلف مع الأدابتر وبدونه. برومبت الاستخراج قصير فتكفيه نسخة وحدة.
caches = {name: PromptCache(model, tokenizer, min(1, args.prompt_cache_slots) if adapter_on and args.base_name else args.prompt_cache_slots)
          for name, adapter_on in names.items()}


def use(name):
    """يُستدعى داخل القفل قبل التوليد: يفعّل الأدابتر أو يعطّله حسب اسم النموذج المطلوب."""
    for layer, scale in zip(loras, scales):
        layer.scale = scale if names[name] else 0.0
    return caches[name]
last_activity = time.monotonic()

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def reply(self, code, value):
        body = json.dumps(value, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        global last_activity
        last_activity = time.monotonic()
        if self.path != '/v1/models':
            return self.reply(404, {'error': 'not_found'})
        self.reply(200, {'object': 'list', 'data': [{'id': name, 'object': 'model'} for name in names]})

    def stream_reply(self, ids, tokens, tools, name):
        # بث بصيغة OpenAI SSE. مع وجود أدوات نحجز البداية حتى يتضح هل الرد استدعاء أداة (<tool_call>) فيُرسل كاملاً في النهاية.
        global last_activity
        allowed = {t['function']['name'] for t in tools} if tools else set()
        marker, text, sent, finish = '<tool_call>', '', 0, 'stop'
        mode = 'probe' if allowed else 'text'
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream; charset=utf-8')
        self.send_header('Cache-Control', 'no-cache')
        self.end_headers()
        def emit(value):
            self.wfile.write(b'data: ' + json.dumps(value, ensure_ascii=False).encode('utf-8') + b'\n\n')
            self.wfile.flush()
        def chunk(delta, reason=None):
            emit({'model': name, 'choices': [{'index': 0, 'delta': delta, 'finish_reason': reason}]})
        with lock:
            try:
                for part in use(name).generate(ids, max_tokens=tokens, sampler=make_sampler(temp=0), prefill_step_size=args.prefill_step):
                    text += part.text
                    if getattr(part, 'finish_reason', None):
                        finish = part.finish_reason
                    if mode == 'probe':
                        head = text.lstrip()
                        if not head or marker.startswith(head):
                            continue
                        mode = 'tool' if head.startswith(marker) else 'text'
                    if mode == 'text' and len(text) > sent:
                        chunk({'content': text[sent:]})
                        sent = len(text)
            finally:
                mx.clear_cache()
        calls = parse_tool_calls(text, allowed) if mode != 'text' else []
        if calls:
            chunk({'tool_calls': calls}, 'tool_calls')
        else:
            if len(text) > sent:
                chunk({'content': text[sent:]})
            chunk({}, 'length' if finish == 'length' else 'stop')
        self.wfile.write(b'data: [DONE]\n\n')
        self.wfile.flush()
        last_activity = time.monotonic()

    def do_POST(self):
        global last_activity
        last_activity = time.monotonic()
        if self.path != '/v1/chat/completions':
            return self.reply(404, {'error': 'not_found'})
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 131072:
                return self.reply(400, {'error': 'invalid_request'})
            body = json.loads(self.rfile.read(size))
            messages = body.get('messages')
            name = body.get('model')
            if name not in names or not isinstance(messages, list) or not 1 <= len(messages) <= 30:
                return self.reply(400, {'error': 'invalid_request'})
            if any(not isinstance(m, dict) or m.get('role') not in ['user', 'assistant', 'system', 'tool'] or
                   (not isinstance(m.get('content'), str) and not (m.get('role') == 'assistant' and isinstance(m.get('tool_calls'), list))) for m in messages):
                return self.reply(400, {'error': 'invalid_request'})
            tools = body.get('tools')
            if tools is not None and (not isinstance(tools, list) or len(tools) > 8 or any(t.get('type') != 'function' for t in tools)):
                return self.reply(400, {'error': 'invalid_request'})
            prompt = tokenizer.apply_chat_template(messages, tools=tools, tokenize=False, add_generation_prompt=True, enable_thinking=False)
            ids = encode(tokenizer, prompt)
            if len(ids) > args.max_context:
                # الحجم وتوزيعه على الرسائل يظهر في نافذة WSL ليُعرف أي جزء أخذ المساحة
                parts = ', '.join(f"{m.get('role')} {len(tokenizer.encode(m.get('content') or ''))}" for m in messages)
                tool_tokens = len(tokenizer.encode(json.dumps(tools, ensure_ascii=False))) if tools else 0
                print(f'[serve-mlx] context_too_long: {len(ids)} tokens > {args.max_context} | {parts} | tools {tool_tokens}', flush=True)
                return self.reply(400, {'error': 'context_too_long', 'tokens': len(ids), 'max': args.max_context})
            tokens = max(1, min(1024, int(body.get('max_tokens', 512))))
            if body.get('stream') is True:
                return self.stream_reply(ids, tokens, tools, name)
            with lock:
                try:
                    answer = ''.join(part.text for part in use(name).generate(ids, max_tokens=tokens, sampler=make_sampler(temp=0), prefill_step_size=args.prefill_step))
                finally:
                    mx.clear_cache()
            last_activity = time.monotonic()
            calls = parse_tool_calls(answer, {t['function']['name'] for t in tools} if tools else set())
            message = {'role': 'assistant', 'content': None, 'tool_calls': calls} if calls else {'role': 'assistant', 'content': answer}
            self.reply(200, {'model': name, 'choices': [{'message': message, 'finish_reason': 'tool_calls' if calls else 'stop'}]})
        except (ValueError, TypeError, KeyError):
            self.reply(400, {'error': 'invalid_request'})
        except Exception:
            traceback.print_exc()  # السبب يظهر في نافذة WSL
            self.reply(500, {'error': 'inference_failed'})

server = HTTPServer(('127.0.0.1', args.port), Handler)
server.timeout = 1
print(json.dumps({'ready': True, 'port': args.port, 'models': list(names), 'adapter_loaded': bool(args.adapter), 'lora_layers': len(loras),
                  'prompt_cache_slots': {name: cache.size for name, cache in caches.items()}}), flush=True)
try:
    if args.idle_timeout:
        while time.monotonic() - last_activity < args.idle_timeout:
            server.handle_request()
    else:
        server.serve_forever()
finally:
    server.server_close()
