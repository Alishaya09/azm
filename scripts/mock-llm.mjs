// نموذج وهمي متوافق مع OpenAI API لتجربة ربط المساعد الذكي بدون نموذج حقيقي.
// التشغيل:  node scripts/mock-llm.mjs        (يشتغل على http://127.0.0.1:11500/v1)
// ثم شغّل الخادم بـ: AZM_AI_PROVIDER=openai  AZM_AI_BASE_URL=http://127.0.0.1:11500/v1  AZM_AI_MODEL=mock
// يرد بملخص من لقطة العمليات اللي وصلته، عشان تتأكد إن البيانات توصل للنموذج بشكل صحيح.
import http from 'node:http';

const port = Number(process.env.MOCK_LLM_PORT || 11500);

http.createServer((req, res) => {
  if (req.method !== 'POST' || !req.url.endsWith('/chat/completions')) { res.writeHead(404); return res.end(); }
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const snapshotMsg = body.messages.find(m => m.role === 'system' && m.content.startsWith('Current operational snapshot'));
    const snapshot = snapshotMsg ? JSON.parse(snapshotMsg.content.slice(snapshotMsg.content.indexOf('{'))) : null;
    const question = [...body.messages].reverse().find(m => m.role === 'user')?.content || '';
    const units = snapshot ? snapshot.units.map(u => `${u.id} (fuel ${u.stockPercent.fuel}%)`).join(', ') : 'none';
    const content = `[mock:${body.model}] Q="${question}" · viewer=${snapshot?.viewer.username} · units: ${units} · history=${body.messages.filter(m => m.role !== 'system').length}`;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: 'mock', object: 'chat.completion', model: body.model, choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }] }));
  });
}).listen(port, '127.0.0.1', () => console.log(`Mock LLM: http://127.0.0.1:${port}/v1`));
