// اتصال تحديث حي يستخدم نفس مصادقة التبويب. البيانات الفعلية تُجلب من /api/state بنطاقها المعتاد.
import { onStateSaved } from '../lib/events.mjs';
import { currentUser } from '../store/sessions.mjs';

export async function handleEvents({ req, res, path, method }) {
  if (path !== '/api/events' || method !== 'GET') return false;
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  const emit = event => {
    if(res.destroyed||res.writableEnded)return;
    if (!currentUser(req)) { res.end('event: session-expired\ndata: {}\n\n'); return; }
    if (res.writableLength > 65536) { res.destroy(); return; }
    res.write(`event: ${event}\ndata: {}\n\n`);
  };
  emit('ready');
  const unsubscribe = onStateSaved(() => emit('changed'));
  const heartbeat = setInterval(() => emit('heartbeat'), 15000); heartbeat.unref();
  res.on('close', () => { clearInterval(heartbeat); unsubscribe(); });
  return true;
}
