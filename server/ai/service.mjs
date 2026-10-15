// حالة اتصال مقاسة؛ الإعداد وحده لا يعني نجاح الاتصال. لا نعيد عنواناً أو مفتاحاً للمتصفح.
const services = new WeakMap();
export const configuredAI = c => c.provider === 'openai' && !!c.model;
export const serviceStatus = c => {
  const last = services.get(c) || {};
  return { configured: configuredAI(c), connected: configuredAI(c) && last.connected === true, provider: c.provider,
    model: c.model || null, checkedAt: last.checkedAt || null, error: last.error || null,
    state: !configuredAI(c) ? 'not_configured' : last.connected ? 'connected' : last.checkedAt ? 'unavailable' : 'unverified' };
};
export const markService = (c, error = null) => services.set(c, { connected: !error, checkedAt: Date.now(), error });
export async function probeService(c) {
  if (!configuredAI(c)) return serviceStatus(c);
  const last = services.get(c);
  if (last?.pending) return last.pending;
  if (last?.checkedAt && Date.now() - last.checkedAt < 15000) return serviceStatus(c);
  const pending = (async () => {
    try {
      const response = await fetch(`${c.baseUrl}/models`, { headers: c.apiKey ? { Authorization: `Bearer ${c.apiKey}` } : {}, signal: AbortSignal.timeout(Math.max(100, Math.min(Number(c.timeoutMs) || 5000, 5000))) });
      if (!response.ok) throw new Error('ai_unavailable');
      const json = await response.json();
      if (!Array.isArray(json.data) || !json.data.some(m => m?.id === c.model)) throw new Error('ai_model_missing');
      markService(c); // الخدمة أعلنت توفر النموذج؛ نجاح التوليد يُحدّث الحالة أيضاً.
    } catch(e) { markService(c, e.message === 'ai_model_missing' ? 'ai_model_missing' : e.name === 'TimeoutError' ? 'ai_timeout' : 'ai_unavailable'); }
    return serviceStatus(c);
  })();
  services.set(c, { ...last, pending });
  return pending;
}
