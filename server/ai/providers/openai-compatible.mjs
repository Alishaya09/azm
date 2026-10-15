// موصّل لأي خادم متوافق مع OpenAI Chat Completions API:
// Ollama (http://localhost:11434/v1)، vLLM، LM Studio، llama.cpp server، أو خدمة سحابية.
import { markService } from '../service.mjs';
export async function modelMessage(config, messages, tools = null) {
  const { baseUrl, model, apiKey, temperature, timeoutMs, maxTokens } = config;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify({ model, messages, temperature, max_tokens: Math.max(1, Math.min(4096, Number(maxTokens) || 768)), stream: false, chat_template_kwargs: { enable_thinking: false }, ...(tools ? { tools, tool_choice:'auto' } : {}) }),
      signal: controller.signal,
    });
    // 400 بسبب طول السياق ليس انقطاعاً: الخدمة شغالة والطلب أكبر من نافذة النموذج
    if (!res.ok) throw new Error(res.status === 400 && /context|too long|maximum.*length/i.test(await res.text().catch(() => '')) ? 'ai_context_too_long' : 'ai_unavailable');
    const data = await res.json();
    const message = data?.choices?.[0]?.message, text = message?.content;
    if (tools && Array.isArray(message?.tool_calls) && message.tool_calls.length>0 && message.tool_calls.length<=3 && message.tool_calls.every(c=>typeof c?.id==='string'&&c.id.length<=80&&c.type==='function'&&typeof c.function?.name==='string'&&typeof c.function?.arguments==='string'&&c.function.arguments.length<=4000)) { markService(config); return {role:'assistant',content:typeof text==='string'?text:null,tool_calls:message.tool_calls.map(c=>({id:c.id,type:'function',function:{name:c.function.name,arguments:c.function.arguments}}))}; }
    if (typeof text !== 'string' || !text.trim() || data.choices[0].finish_reason === 'length') throw new Error('invalid_model_response');
    markService(config);
    return {role:'assistant',content:text.trim()};
  } catch(e) {
    const code = controller.signal.aborted ? 'ai_timeout' : ['ai_unavailable','invalid_model_response','ai_context_too_long'].includes(e.message) ? e.message : 'ai_unavailable';
    markService(config, code === 'ai_context_too_long' ? null : code); throw new Error(code);
  } finally {
    clearTimeout(timer);
  }
}
export async function chatCompletion(config,messages) { return (await modelMessage(config,messages)).content; }

// بث الرد (stream: true) بصيغة OpenAI SSE. onDelta(text) لكل جزء نصي؛ المستدعي يمسح النص (onDelta(null)) إذا انتهى الرد باستدعاء أداة.
// يرجع نفس شكل modelMessage: { role, content } أو { role, content, tool_calls }.
// خطأ stream_unsupported يعني أن الخدمة رفضت البث (400) فيرجع المستدعي للطلب العادي.
export async function modelStream(config, messages, tools = null, onDelta = () => {}) {
  const { baseUrl, model, apiKey, temperature, timeoutMs, maxTokens } = config;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let text = '', finish = null;
  const calls = [];
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify({ model, messages, temperature, max_tokens: Math.max(1, Math.min(4096, Number(maxTokens) || 768)), stream: true, chat_template_kwargs: { enable_thinking: false }, ...(tools ? { tools, tool_choice: 'auto' } : {}) }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      if (res.status === 400 && /context|too long|maximum.*length/i.test(body)) throw new Error('ai_context_too_long');
      throw new Error(res.status === 400 ? 'stream_unsupported' : 'ai_unavailable');
    }
    if (!/event-stream/i.test(res.headers.get('content-type') || '')) throw new Error('stream_unsupported');
    const reader = res.body.getReader(), decoder = new TextDecoder();
    let buf = '';
    const handle = line => {
      if (!line.startsWith('data:')) return;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') return;
      let json; try { json = JSON.parse(data); } catch { return; }
      const choice = json?.choices?.[0]; if (!choice) return;
      if (choice.finish_reason) finish = choice.finish_reason;
      const delta = choice.delta || {};
      if (Array.isArray(delta.tool_calls)) {
        delta.tool_calls.forEach((c, k) => {
          const i = Number.isInteger(c?.index) ? c.index : k;
          const cur = calls[i] ||= { id: '', type: 'function', function: { name: '', arguments: '' } };
          if (typeof c?.id === 'string' && c.id) cur.id = c.id;
          if (typeof c?.function?.name === 'string' && !cur.function.name) cur.function.name = c.function.name;
          if (typeof c?.function?.arguments === 'string') cur.function.arguments += c.function.arguments;
        });
      }
      if (typeof delta.content === 'string' && delta.content) {
        text += delta.content;
        if (!calls.length) onDelta(delta.content);
      }
    };
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let at;
      while ((at = buf.indexOf('\n')) >= 0) { handle(buf.slice(0, at).trim()); buf = buf.slice(at + 1); }
    }
    handle(buf.trim());
    const list = calls.filter(Boolean).map((c, i) => ({ ...c, id: c.id || `azm_call_${i}` }));
    if (list.length) {
      if (list.length > 3 || !list.every(c => c.function.name && c.id.length <= 80 && c.function.arguments.length <= 4000)) throw new Error('invalid_model_response');
      markService(config);
      return { role: 'assistant', content: text || null, tool_calls: list };
    }
    if (!text.trim()) throw new Error('invalid_model_response');
    markService(config);
    return { role: 'assistant', content: text.trim(), truncated: finish === 'length' };
  } catch (e) {
    const code = controller.signal.aborted ? 'ai_timeout' : ['ai_unavailable', 'invalid_model_response', 'ai_context_too_long', 'stream_unsupported'].includes(e.message) ? e.message : 'ai_unavailable';
    if (code !== 'stream_unsupported') markService(config, code === 'ai_context_too_long' ? null : code);
    throw new Error(code);
  } finally {
    clearTimeout(timer);
  }
}
