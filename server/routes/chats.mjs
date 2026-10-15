// المساعد الذكي: المحادثات المحفوظة + حالة ربط النموذج.
import { cleanText, readBody, send } from '../lib/http.mjs';
import { chatSummary, createChat, deleteChat, listChats, saveChats, trimChat } from '../store/chats.mjs';
import { generateReply } from '../ai/index.mjs';
import { AI } from '../config.mjs';
import { probeService } from '../ai/service.mjs';

export async function handleChats({ req, res, path, method, me }) {
  if (path === '/api/ai/status' && method === 'GET') return send(res, 200, await probeService(AI));
  if (path === '/api/chats' && method === 'GET') return send(res, 200, listChats(me.username).map(chatSummary).sort((a, b) => b.updatedAt - a.updatedAt));

  const m = path.match(/^\/api\/chats(?:\/([A-Za-z0-9-]+))?(\/messages)?$/);
  if (!m) return false;
  const [, chatId, isMessages] = m, list = listChats(me.username);
  if (chatId && !isMessages && method === 'GET') { const c = list.find(x => x.id === chatId); return c ? send(res, 200, c) : send(res, 404, { error: 'not_found' }); }
  if (chatId && !isMessages && method === 'DELETE') { deleteChat(me.username, chatId); return send(res, 200, { ok: true }); }
  // رسالة جديدة: بدون رقم = محادثة جديدة، ومع رقم = إضافة على محادثة موجودة
  if (method === 'POST' && (!chatId || isMessages)) {
    const text = cleanText((await readBody(req)).text, 4000);
    if (!text) return send(res, 400, { error: 'invalid_comment' });
    let c = chatId && list.find(x => x.id === chatId);
    if (chatId && !c) return send(res, 404, { error: 'not_found' });
    if (!c) c = createChat(me.username, text);
    c.messages.push({ role: 'user', text, at: Date.now() });
    // بث الرد أثناء كتابته (Accept: application/x-ndjson): سطر JSON لكل حدث — start ثم delta/reset ثم done بالمحادثة كاملة.
    // بدون هذا الرأس يبقى الرد الكامل دفعة وحدة كما كان.
    if (/application\/x-ndjson/i.test(req.headers.accept || '')) {
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
      const write = event => { if (!res.destroyed && !res.writableEnded) res.write(JSON.stringify(event) + '\n'); };
      write({ type: 'start', chatId: c.id });
      const reply = await generateReply(me, c, delta => write(delta === null ? { type: 'reset' } : { type: 'delta', text: delta }));
      c.messages.push(reply);
      trimChat(c); saveChats();
      write({ type: 'done', chat: c });
      res.end();
      return true;
    }
    c.messages.push(await generateReply(me, c));
    trimChat(c); saveChats();
    return send(res, 200, c);
  }
  return false;
}
