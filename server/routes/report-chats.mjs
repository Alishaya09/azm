// محادثات التقارير منفصلة عن مساعد الطلبات، وكل سؤال يعاد حساب تقريره بنطاق الجلسة.
import { readBody, cleanText, send } from '../lib/http.mjs';
import { chatSummary, createChat, deleteChat, listChats, saveChats, trimChat } from '../store/chats.mjs';
import { generateReportChatReply, probeRag, reportAiStatus } from '../ai/report.mjs';
import { REPORT_AI } from '../config.mjs';
import { probeService } from '../ai/service.mjs';

export async function handleReportChats({ req, res, path, method, me, scope }) {
  if (path === '/api/report-ai/status' && method === 'GET') { await Promise.all([probeService(REPORT_AI), probeRag()]); return send(res, 200, reportAiStatus()); }
  if (!path.startsWith('/api/report-chats')) return false;
  const owner = `${me.username}::report`;
  if (path === '/api/report-chats' && method === 'GET') return send(res, 200, listChats(owner).map(chatSummary).sort((a, b) => b.updatedAt - a.updatedAt));
  const m = path.match(/^\/api\/report-chats(?:\/([A-Za-z0-9-]+))?(\/messages)?$/);
  if (!m) return false;
  const [, id, messages] = m, list = listChats(owner);
  if (id && !messages && method === 'GET') { const c = list.find(x => x.id === id); return c ? send(res, 200, c) : send(res, 404, { error: 'not_found' }); }
  if (id && !messages && method === 'DELETE') { deleteChat(owner, id); return send(res, 200, { ok: true }); }
  if (method === 'POST' && (!id || messages)) {
    const body = await readBody(req), question = cleanText(body.text, 4000);
    if (!question) return send(res, 400, { error: 'invalid_comment' });
    let chat = id && list.find(x => x.id === id);
    if (id && !chat) return send(res, 404, { error: 'not_found' });
    if (!chat) chat = createChat(owner, question);
    chat.messages.push({ role: 'user', text: question, at: Date.now() });
    chat.messages.push(await generateReportChatReply(me, scope, chat, body.language === 'en' ? 'en' : 'ar'));
    trimChat(chat); saveChats();
    return send(res, 200, chat);
  }
  return false;
}
