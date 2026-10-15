// التواصل مع الخادم
// معرّف غير سري لكل تبويب؛ رمز الجلسة يبقى حصراً في كوكي HttpOnly على الخادم والمتصفح.
const azmTabKey = 'azm-tab-id';
const newAzmTabId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
let azmTabId;
try { azmTabId = sessionStorage.getItem(azmTabKey); } catch {}
if (!/^[a-f0-9]{32}$/.test(azmTabId || '')) azmTabId = newAzmTabId();
const saveAzmTabId = () => { try { sessionStorage.setItem(azmTabKey, azmTabId); } catch {} };
saveAzmTabId();
// نسخ تبويب أو فتحه عبر opener قد ينسخ sessionStorage؛ التبويب الجديد يأخذ هوية جديدة.
// نتبادل معرّفات غير سرية فقط، ولا نرسل أي كوكي أو رمز جلسة في القناة.
let azmTabChannel;
const azmTabReady = new Promise(resolve => {
  // Web Locks يحسم الملكية حتى لو كان التبويب الأصلي بالخلفية؛ ينفك القفل عند إغلاق المستند.
  if (navigator.locks) {
    const claim = () => navigator.locks.request(`azm-tab-${azmTabId}`, { ifAvailable: true }, lock => {
      if (!lock) { azmTabId = newAzmTabId(); saveAzmTabId(); return claim(); }
      resolve();
      return new Promise(() => {}); // احتفاظ بالقفل طوال عمر هذا المستند
    });
    claim(); return;
  }
  // HTTP على شبكة محلية قد لا يدعم Web Locks؛ نحافظ على قناة ملكية مفتوحة.
  // التنقل الجديد قد يحمل sessionStorage من opener؛ نبدأ جلسة جديدة ولا نعتمد على استجابة تبويب خلفي.
  // Reload وحده يستعيد المعرّف، لذلك تحديث الصفحة يحافظ على الحساب.
  if (performance.getEntriesByType('navigation')[0]?.type !== 'reload') { azmTabId = newAzmTabId(); saveAzmTabId(); }
  if (typeof BroadcastChannel === 'undefined') return resolve();
  const channel = azmTabChannel = new BroadcastChannel('azm-tab-ownership'), probe = newAzmTabId();
  let ready = false;
  channel.onmessage = ({ data }) => {
    if (!data || data.id !== azmTabId || data.probe === probe) return;
    if (data.kind === 'probe') {
      if (ready || probe < data.probe) channel.postMessage({ kind: 'owned', id: azmTabId, probe, target: data.probe });
    } else if (!ready && data.kind === 'owned' && data.target === probe) { azmTabId = newAzmTabId(); saveAzmTabId(); }
  };
  channel.postMessage({ kind: 'probe', id: azmTabId, probe });
  setTimeout(() => { ready = true; resolve(); }, 300);
});
let azmAuthEpoch = 0;
// إشعار بالتغيير فقط؛ كل تبويب يعيد جلب البيانات بصلاحيته ولا نتبادل أي بيانات عمليات بين الحسابات.
const azmStateChanges = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('azm-state-invalidated');
if (azmStateChanges) azmStateChanges.onmessage = ({ data }) => { if (data?.kind === 'changed') window.dispatchEvent(new Event('azm-state-invalidated')); };
// جميع طلبات API (بما فيها التحديث والخريطة والتقارير والشات) تمر من هنا بنفس هوية التبويب.
// عند الخطأ: e.code = رمز الخطأ، وتفاصيل إضافية من الخادم (reason، shortages، available…) تنضاف على e
const api = async (path, { method = 'GET', body } = {}) => {
  await azmTabReady;
  if (path === '/api/login' || path === '/api/logout') azmAuthEpoch++;
  const epoch = azmAuthEpoch;
  const r = await fetch(path, { method, credentials: 'same-origin', headers: { 'X-Azm-Tab': azmTabId, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  // لا تسمح لرد قديم بإعادة بيانات حساب سابق بعد دخول/خروج التبويب.
  if (epoch !== azmAuthEpoch) { const e = new Error('bad_request'); Object.assign(e, { status: 409, code: 'bad_request' }); throw e; }
  if (!r.ok) { const e = new Error(data.error || 'error'); Object.assign(e, data, { status: r.status, code: data.error }); throw e; }
  if (method !== 'GET' && /^\/api\/(requests|inventory|depots|entities|layout|catalog)(\/|$)/.test(path)) {
    window.dispatchEvent(new Event('azm-state-invalidated'));
    azmStateChanges?.postMessage({ kind: 'changed' });
  }
  return data;
};

// fetch بدلاً من EventSource حتى يحمل اتصال الأحداث X-Azm-Tab أيضاً.
const watchAzmState = (changed, expired) => {
  const controller = new AbortController(); let active = true;
  (async () => {
    await azmTabReady;
    while (active) {
      try {
        const response = await fetch('/api/events', { credentials: 'same-origin', headers: { 'X-Azm-Tab': azmTabId }, signal: controller.signal });
        if (response.status === 401) { if(active)expired(); break; }
        if (!response.ok || !response.body) throw new Error('events_unavailable');
        const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '';
        while (active) {
          const chunk = await reader.read(); if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          let end;
          while ((end = buffer.indexOf('\n\n')) >= 0) {
            const message = buffer.slice(0, end); buffer = buffer.slice(end + 2);
            if (!active) break;
            if (/^event: (ready|changed)$/m.test(message)) changed();
            if (/^event: session-expired$/m.test(message)) { expired(); active = false; controller.abort(); break; }
          }
        }
      } catch { /* التحديث الدوري يبقى بديلاً إذا انقطع الاتصال الحي */ }
      if (active) await new Promise(resolve => {
        const done = () => { clearTimeout(timer); controller.signal.removeEventListener('abort', done); resolve(); };
        const timer = setTimeout(done, 2000); controller.signal.addEventListener('abort', done, { once: true });
      });
    }
  })();
  return () => { active = false; controller.abort(); };
};
