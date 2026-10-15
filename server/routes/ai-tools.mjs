import { REQUEST_AI } from '../config.mjs';
import { readBody, send, cleanText } from '../lib/http.mjs';
import { chatCompletion } from '../ai/providers/openai-compatible.mjs';
import { requestToolSchema, validateRequestDraft, REQUEST_SYSTEM_PROMPT } from '../ai/request-contract.mjs';
import { unitAllows, unitRequestable } from '../store/hierarchy.mjs';
import { configuredAI, probeService } from '../ai/service.mjs';
import { readToolSchemas, executeReadTool } from '../ai/read-tools.mjs';

export async function handleAiTools({ req, res, path, method, me, scope }) {
  if (path === '/api/ai/request-status' && method === 'GET') return send(res, 200, await probeService(REQUEST_AI));
  if (path === '/api/ai/tools' && method === 'GET') return send(res, 200, { tools: readToolSchemas });
  if (path === '/api/ai/tools/read' && method === 'POST') {
    const result = executeReadTool(me, scope, await readBody(req));
    return send(res, result.error ? result.error === 'out_of_scope' ? 403 : 400 : 200, result);
  }
  if (path === '/api/ai/request-schema' && method === 'GET') return send(res, 200, requestToolSchema);
  if (path !== '/api/ai/request-draft' || method !== 'POST') return false;
  const body = await readBody(req), input = cleanText(body.text, 4000);
  if (!input) return send(res, 400, { error: 'invalid_comment' });
  const unitId = me.role === 'user' ? me.unitId : body.unitId;
  if (!unitId || !scope.unitIds.has(unitId)) return send(res, 403, { error: 'out_of_scope' });
  if (!configuredAI(REQUEST_AI)) return send(res, 503, { error: 'ai_not_connected' });
  try {
    const answer = await chatCompletion(REQUEST_AI, [
      { role: 'system', content: REQUEST_SYSTEM_PROMPT },
      { role: 'user', content: input },
    ]);
    const parsed = validateRequestDraft(answer, input);
    if (parsed.error) return send(res, 422, parsed);
    // المسودة تبقى للمراجعة فقط. الصنف غير التشغيلي للوحدة يظهر معلَّماً ولا يدخل نموذج الطلب؛ لا يُنشأ أي طلب هنا.
    const items = parsed.draft.items.map(i => ({ ...i, requestable: unitRequestable(unitId, i.resource), ...(!unitRequestable(unitId, i.resource) ? { blockedReason: unitAllows(unitId, i.resource) ? 'resource_not_operational' : 'resource_not_assigned' } : {}) }));
    const usable = items.filter(i => i.requestable);
    const draft = { ...parsed.draft, items, ready: !parsed.draft.missing.length && usable.length > 0 && usable.every(x => x.availableInCatalog && Number.isInteger(x.qty)) };
    return send(res, 200, { ...parsed, draft, unitId, sourceText: input });
  } catch (e) {
    console.error(`[AI draft] ${e.message}`);
    return send(res, 502, { error: e.message === 'ai_timeout' ? 'ai_timeout' : 'ai_error' });
  }
}
