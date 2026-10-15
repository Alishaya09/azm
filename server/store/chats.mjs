// محادثات المساعد الذكي: تنحفظ لكل مستخدم في data/chats.json — كل مستخدم يشوف محادثاته هو فقط.
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DATA_DIR } from '../config.mjs';
import { readJson, writeJson } from '../lib/storage.mjs';
import { appendAudit, auditActor } from './audit.mjs';
import { state, saveState } from './db.mjs';

const chatsFile = join(DATA_DIR, 'chats.json');
const MAX_CHATS_PER_USER = 200, MAX_MESSAGES_PER_CHAT = 500;

const chats = readJson(chatsFile, {});
export const saveChats = () => {
  writeJson(chatsFile, chats);
  appendAudit(state, 'chats', 'chats', { owner: auditActor().by });
  saveState();
};
export const chatSummary = c => ({ id: c.id, title: c.title, updatedAt: c.updatedAt, count: c.messages.length });

export const listChats = username => chats[username] ||= [];
export const deleteChat = (username, id) => { chats[username] = listChats(username).filter(x => x.id !== id); saveChats(); };
// محادثة جديدة؛ إذا وصل المستخدم للحد نحذف الأقدم تحديثاً
export const createChat = (username, firstText) => {
  const list = listChats(username);
  if (list.length >= MAX_CHATS_PER_USER) list.splice(list.reduce((oldest, x, i) => x.updatedAt < list[oldest].updatedAt ? i : oldest, 0), 1);
  const c = { id: `C-${Date.now().toString(36)}${randomBytes(3).toString('hex')}`, title: firstText.slice(0, 60), createdAt: Date.now(), updatedAt: Date.now(), messages: [] };
  list.push(c);
  return c;
};
export const trimChat = c => { c.messages = c.messages.slice(-MAX_MESSAGES_PER_CHAT); c.updatedAt = Date.now(); };
