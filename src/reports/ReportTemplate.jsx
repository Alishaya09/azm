// قالب التقارير الموحّد (تقرير تشغيلي A4): نفس الشكل لكل تقرير يُنشأ من النظام، ويُعبّأ ديناميكياً من بيانات التقرير.
// المدخل «مستند» عام: عنوان، حالة، بيانات أساسية، ملخص، مؤشرات، وأقسام (حقول / جدول / تسلسل زمني / نقاط / نص).
// الأقسام الفارغة تُحذف والترقيم يُعاد تلقائياً. الطباعة في إطار مخفي، والمتصفح يحفظه PDF.
const rptEsc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rptHash = s => { let h = 0x811c9dc5; for (const c of String(s)) { h ^= c.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; } return h; };
const rptHex = (s, n = 8) => (rptHash(s).toString(16) + rptHash(`${s}#`).toString(16)).toUpperCase().padStart(16, '0').slice(0, n);
const rptDate = (ms, lang) => {
  if (!Number.isFinite(ms)) return '—';
  const d = new Date(ms), day = new Intl.DateTimeFormat(lang === 'ar' ? 'ar-u-nu-latn-ca-gregory' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).format(d);
  return `${day} - ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const rptShort = ms => { if (!Number.isFinite(ms)) return '—'; const d = new Date(ms), p = n => String(n).padStart(2, '0'); return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`; };
const rptTone = status => ({ delivered: 'ok', approved: 'info', assigned: 'ok', pending: 'warn', rejected: 'bad' }[status] || 'info');

// نص التحليل الذكي: «عنوان:» يبدأ قسماً، و«- » بند. يرجع الأقسام بأنواعها (ملخص/ملاحظات/توصيات/أخرى)
function rptNarrative(text) {
  const out = []; let cur = null;
  for (const raw of String(text || '').split('\n')) {
    const l = raw.trim().replace(/\*\*/g, ''); if (!l) continue;
    if (/[:：]$/.test(l) && l.length <= 40 && !/^[-•*]\s/.test(l)) { cur = { title: l.replace(/[:：]$/, ''), lines: [] }; out.push(cur); continue; }
    if (!cur) { cur = { title: '', lines: [] }; out.push(cur); }
    cur.lines.push(l.replace(/^[-•*]\s+/, ''));
  }
  return out.map(s => ({ ...s, kind: /ملخص|summary/i.test(s.title) || !s.title ? 'summary' : /أبرز|key figures|highlights/i.test(s.title) ? 'figures' : /توصي|recommend/i.test(s.title) ? 'recs' : /ملاحظ|notes|observ/i.test(s.title) ? 'notes' : 'other' }));
}

function rptSection(s, n) {
  const head = `<div class="sec-head"><span class="num">${String(n).padStart(2, '0')}</span><div><h2>${rptEsc(s.title)}</h2>${s.sub ? `<small>${rptEsc(s.sub)}</small>` : ''}</div></div>`;
  let body = '';
  if (s.type === 'fields') body = `<div class="fields">${s.fields.map(f => `<div class="field"><small>${rptEsc(f.label)}</small><b dir="auto">${rptEsc(f.value)}</b></div>`).join('')}</div>`;
  else if (s.type === 'table') body = `<table><thead><tr>${s.columns.map(c => `<th>${rptEsc(c)}</th>`).join('')}</tr></thead><tbody>${s.rows.map(r => `<tr>${r.map((c, i) => `<td${s.numeric?.includes(i) ? ' class="n"' : ''}>${rptEsc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  else if (s.type === 'timeline') body = `<ol class="timeline">${s.events.map(e => `<li><i></i><div><b>${rptEsc(e.title)}</b>${e.desc ? `<small>${rptEsc(e.desc)}</small>` : ''}</div><time>${rptEsc(e.time)}</time></li>`).join('')}</ol>`;
  else if (s.type === 'bullets') body = `<ul class="bullets">${s.items.map(x => `<li>${rptEsc(x)}</li>`).join('')}</ul>`;
  else if (s.type === 'qa') body = s.items.map(x => `<div class="qa"><b>${rptEsc(x.q)}</b>${x.a.map(a => `<p>${rptEsc(a)}</p>`).join('')}</div>`).join('');
  return `<section class="sec">${head}${body}</section>`;
}

const rptHasContent = s => s && (s.type === 'fields' ? s.fields?.length : s.type === 'table' ? s.rows?.length : s.type === 'timeline' ? s.events?.length : s.items?.length);

// المستند ← صفحة HTML كاملة جاهزة للطباعة (A4)
function azmReportHtml(doc) {
  const rtl = doc.lang !== 'en', sections = doc.sections.filter(rptHasContent);
  const logo = `${location.origin}/src/assets/azm-logo.png`;
  return `<!doctype html><html lang="${rtl ? 'ar' : 'en'}" dir="${rtl ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><title>${rptEsc(doc.title)} ${rptEsc(doc.number)}</title><style>
@page{size:A4;margin:14mm 12mm 16mm;@bottom-left{content:counter(page) " / " counter(pages);font:9px Tahoma,Arial,sans-serif;color:#6b7280}@bottom-right{content:"${rptEsc(doc.labels.footer)}";font:9px Tahoma,Arial,sans-serif;color:#6b7280}}
*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;font-family:Tahoma,"Segoe UI",Arial,sans-serif;color:#1f2937;font-size:11px;background:#fff}
.banner{position:relative;height:96px;border-radius:6px 6px 0 0;background:linear-gradient(135deg,#071426 0%,#0d2440 55%,#0a1c33 100%);overflow:hidden;border-bottom:3px solid #1e88e5;display:flex;align-items:center;justify-content:space-between;padding:0 26px;color:#fff}
.banner svg.net{position:absolute;inset:0;width:100%;height:100%;opacity:.55}
.brand{position:relative;display:flex;align-items:center;gap:14px}.brand img{height:74px;filter:drop-shadow(0 2px 6px rgba(0,0,0,.5))}
.brand .word{display:flex;align-items:center;gap:12px;font-weight:700}.brand .ar{font-size:24px}.brand .en{font-size:20px;letter-spacing:5px;direction:ltr}.brand .bar{width:2px;height:28px;background:#1e88e5}
.tag{position:relative;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.04);border-radius:4px;padding:8px 18px;text-align:center}
.tag small{display:block;font-size:8px;color:#c7d2e0}.tag b{display:block;font-size:20px;letter-spacing:2px;direction:ltr}.tag i{display:block;font-style:normal;font-size:6px;letter-spacing:1.5px;color:#4ea3f5;direction:ltr}
.title{display:flex;justify-content:space-between;align-items:flex-start;margin:22px 0 16px}
.title .issuer{color:#1e88e5;font-size:9px;font-weight:700}.title h1{margin:4px 0 6px;font-size:21px;color:#111827}.title p{margin:0;color:#6b7280;font-size:10px}
.state{text-align:center}.pill{display:inline-block;padding:6px 26px;border-radius:999px;font-weight:700;font-size:10px;border:1px solid}
.pill.ok{background:#e9f7ef;color:#1e7a46;border-color:#bfe5cd}.pill.info{background:#e8f2fd;color:#1565c0;border-color:#bcd8f6}.pill.warn{background:#fff6e6;color:#a15c00;border-color:#f3d7a6}.pill.bad{background:#fdeceb;color:#b42318;border-color:#f5c2bd}
.state small{display:block;margin-top:6px;color:#9ca3af;font-size:8px}
.meta{display:grid;grid-template-columns:repeat(3,1fr);border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;margin-bottom:14px}
.meta div{padding:10px 14px;border-inline-start:1px solid #e5e7eb;border-top:1px solid #e5e7eb}.meta div:nth-child(3n+1){border-inline-start:0}.meta div:nth-child(-n+3){border-top:0}
.meta small,.field small,.kpi small{display:block;color:#9ca3af;font-size:8px;margin-bottom:6px}.meta b{font-size:10px}
.summary{background:#f0f6fd;border-inline-end:3px solid #1e88e5;border-radius:6px;padding:12px 16px;margin-bottom:14px;break-inside:avoid}
.summary h3{margin:0 0 6px;color:#1565c0;font-size:10px}.summary p{margin:0 0 4px;line-height:1.8;color:#374151}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:22px}
.kpi{border:1px solid #e5e7eb;border-radius:6px;padding:10px 14px;break-inside:avoid}.kpi b{display:block;font-size:17px;color:#1565c0}
.sec{margin:0 0 20px}.sec-head{display:flex;align-items:center;gap:10px;margin-bottom:10px;break-after:avoid}
.sec-head .num{width:24px;height:24px;border-radius:5px;background:#1e88e5;color:#fff;font-weight:700;font-size:9px;display:flex;align-items:center;justify-content:center;flex:none}
.sec-head h2{margin:0;font-size:14px;color:#111827}.sec-head small{color:#9ca3af;font-size:8px}
.fields{display:grid;grid-template-columns:1fr 1fr;gap:6px}.field{background:#f8fafc;border:1px solid #eef1f5;border-radius:6px;padding:9px 14px;break-inside:avoid}.field b{font-size:10px}
table{width:100%;border-collapse:separate;border-spacing:0;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden}
th{background:#1f2937;color:#fff;font-size:9px;padding:9px 12px;text-align:start}td{padding:9px 12px;border-top:1px solid #eef1f5;font-size:9.5px}
tr{break-inside:avoid}tbody tr:nth-child(even) td{background:#f8fafc}td.n{direction:ltr;text-align:end;unicode-bidi:plaintext}
.timeline{list-style:none;margin:0;padding:0}.timeline li{position:relative;display:flex;justify-content:space-between;gap:14px;padding:0 22px 14px 0;break-inside:avoid}
[dir=ltr] .timeline li{padding:0 0 14px 22px}
.timeline li::before{content:"";position:absolute;inset-inline-start:5px;top:10px;bottom:-2px;width:1px;background:#bcd8f6}.timeline li:last-child::before{display:none}
.timeline i{position:absolute;inset-inline-start:0;top:3px;width:11px;height:11px;border-radius:50%;background:#1e88e5;box-shadow:0 0 0 3px #dbeafe}
.timeline b{display:block;font-size:10px}.timeline small{color:#6b7280;font-size:8.5px}.timeline time{color:#6b7280;font-size:8.5px;direction:ltr;white-space:nowrap}
.bullets{margin:0;padding-inline-start:18px}.bullets li{margin-bottom:6px;line-height:1.7}
.qa{margin-bottom:10px;break-inside:avoid}.qa b{display:block;color:#1565c0;margin-bottom:4px}.qa p{margin:0 0 3px;line-height:1.7}
.foot{display:grid;grid-template-columns:1fr 1fr 2fr;gap:12px;align-items:center;background:#1f2937;color:#fff;border-radius:6px;padding:12px 18px;margin-top:8px;break-inside:avoid}
.foot small{display:block;color:#9ca3af;font-size:7.5px;margin-bottom:4px}.foot b{font-size:10px;direction:ltr;unicode-bidi:plaintext}.foot p{margin:0;font-size:8px;color:#d1d5db;line-height:1.6}
</style></head><body>
<header class="banner"><svg class="net" viewBox="0 0 800 96" preserveAspectRatio="none" aria-hidden="true"><g fill="none" stroke="#1e88e5" stroke-opacity=".35"><ellipse cx="420" cy="60" rx="300" ry="60"/><ellipse cx="420" cy="60" rx="200" ry="38"/><path d="M0 70 H180 L210 40 H360 M440 20 H600 L630 50 H800"/></g><g fill="#4ea3f5"><circle cx="210" cy="40" r="2.5"/><circle cx="600" cy="20" r="2.5"/><circle cx="240" cy="82" r="2.5"/><circle cx="520" cy="12" r="2.5"/></g></svg>
<div class="brand"><span class="word"><span class="en">AZM</span><span class="bar"></span><span class="ar">عزم</span></span><img src="${logo}" alt="AZM"></div>
<div class="tag"><small>${rptEsc(doc.labels.badge)}</small><b>C4I</b><i>OPERATIONAL REPORT</i></div></header>
<div class="title"><div><div class="issuer">${rptEsc(doc.labels.issuer)}</div><h1>${rptEsc(doc.title)}</h1><p>${rptEsc(doc.subtitle)}</p></div>
${doc.status ? `<div class="state"><span class="pill ${doc.status.tone}">${rptEsc(doc.status.label)}</span><small>${rptEsc(doc.labels.internal)}</small></div>` : ''}</div>
<div class="meta">${doc.meta.map(m => `<div><small>${rptEsc(m.label)}</small><b dir="auto">${rptEsc(m.value)}</b></div>`).join('')}</div>
${doc.summary?.length ? `<div class="summary"><h3>${rptEsc(doc.labels.summary)}</h3>${doc.summary.map(p => `<p>${rptEsc(p)}</p>`).join('')}</div>` : ''}
${doc.kpis?.length ? `<div class="kpis">${doc.kpis.map(k => `<div class="kpi"><small>${rptEsc(k.label)}</small><b dir="auto">${rptEsc(k.value)}</b></div>`).join('')}</div>` : ''}
${sections.map((s, i) => rptSection(s, i + 1)).join('')}
<footer class="foot"><div><small>${rptEsc(doc.labels.verify)}</small><b>${rptEsc(doc.verify)}</b></div><div><small>${rptEsc(doc.labels.updated)}</small><b>${rptEsc(doc.updated)}</b></div><p>${rptEsc(doc.labels.disclaimer)}</p></footer>
</body></html>`;
}

// طباعة الصفحة في إطار مخفي بعد تحميل الشعار (المتصفح يعطي «حفظ PDF»)
function printAzmReport(html) {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true'); frame.style.cssText = 'position:fixed;width:0;height:0;border:0;inset-inline-start:-9999px';
  document.body.appendChild(frame);
  const w = frame.contentWindow; w.document.open(); w.document.write(html); w.document.close();
  const go = () => { w.focus(); w.print(); setTimeout(() => frame.remove(), 1000); };
  const img = w.document.querySelector('img');
  if (img && !img.complete) { img.onload = img.onerror = go; setTimeout(go, 3000); } else setTimeout(go, 50);
}

// ===== من تقرير سجل العمليات إلى المستند =====
// report: التقرير المحفوظ (stats + messages)، data: من /api/ops-reports/:id/document (الطلبات والتسلسل بنطاق الحساب الحالي)
function buildOpsReportDoc({ report, data, t, lang, layout, me }) {
  const L = k => t(`rpt.${k}`), s = report.stats || {}, reqs = data?.requests || [];
  const nodeOf = id => layout?.nodes?.find(n => n.id === id);
  const partyName = p => !p || p.restricted ? L('restricted') : (nodeOf(p.entityId) ? nodeName(nodeOf(p.entityId), t) : p.label || (p.labelKey ? t(p.labelKey) : '—'));
  const unitOf = r => { const n = layout?.nodes?.find(x => x.unitId && x.unitId === r.unitId); return n ? nodeName(n, t) : r.destination ? partyName(r.destination) : (r.unitId || '—'); };
  const qtyText = (key, q) => `${fmtQty(q)} ${resUnitName(t, key)}`.trim();
  const statusText = st => dict[`ops.reqStatus.${st}`] ? t(`ops.reqStatus.${st}`) : st;
  const modeText = m => m ? t(`mode.${m}`).replace(/^[^\p{L}]+/u, '').trim() : '—';
  const answer = report.messages.find(m => m.role === 'assistant' && m.text);
  const narrative = rptNarrative(answer?.text);
  const pick = kind => narrative.filter(x => x.kind === kind).flatMap(x => x.lines);
  const others = narrative.filter(x => x.kind === 'other').flatMap(x => x.lines.map(l => x.title ? `${x.title}: ${l}` : l));
  const followups = []; let q = null;
  for (const m of report.messages.slice(report.messages.indexOf(answer) + 1)) {
    if (m.role === 'user' && m.kind !== 'report_request') { q = { q: m.text, a: [] }; followups.push(q); }
    else if (m.role === 'assistant' && q && m.text) q.a.push(...m.text.split('\n').map(x => x.trim().replace(/^[-•*]\s+/, '').replace(/\*\*/g, '')).filter(Boolean));
  }
  const number = `RPT-${new Date(report.createdAt || Date.now()).getFullYear()}-${String(rptHash(report.id) % 1000000).padStart(6, '0')}`;
  const base = { lang, number, labels: { badge: L('badge'), issuer: L('issuer'), internal: L('internal'), summary: L('summary'), verify: L('verify'), updated: L('updated'), disclaimer: L('disclaimer'), footer: L('footer') },
    verify: `AZM-${rptHex(`${report.id}|${report.updatedAt}|${s.total}`, 4)}-${rptHex(`${report.id}|${s.lastAt}`, 4)}`, updated: rptDate(report.updatedAt || Date.now(), lang) };
  const notesSec = extra => ({ type: 'bullets', title: L('s.notes'), sub: L('s.notesSub'), items: [...extra, ...pick('notes'), ...others] });
  const recsSec = { type: 'bullets', title: L('s.recs'), sub: L('s.recsSub'), items: pick('recs') };
  const qaSec = { type: 'qa', title: L('s.followup'), sub: L('s.followupSub'), items: followups.filter(x => x.a.length) };
  const summary = pick('summary');

  // تقرير طلب واحد: كل العمليات المحددة لنفس الطلب
  const r = reqs.length === 1 && (s.requestCount === 1) ? reqs[0] : null;
  if (r) {
    const items = r.items || [], byKey = list => Object.fromEntries((list || []).map(i => [i.resource, i.qty]));
    const alloc = byKey(r.approvedItems), sent = byKey(r.dispatched), got = byKey(r.delivered);
    const reqTotal = items.reduce((a, i) => a + (i.qty || 0), 0), allocTotal = items.reduce((a, i) => a + Math.min(i.qty || 0, alloc[i.resource] || 0), 0);
    const measures = new Set(items.map(i => i.measure || resUnitName(t, i.resource)));
    const decided = r.decidedAt && r.createdAt ? Math.max(0, r.decidedAt - r.createdAt) : null;
    const dur = ms => ms == null ? '—' : ms < 3600000 ? t('rpt.minutes', { n: Math.max(1, Math.round(ms / 60000)) }) : ms < 172800000 ? t('rpt.hours', { n: Math.round(ms / 360000) / 10 }) : t('rpt.days', { n: Math.round(ms / 8640000) / 10 });
    const stageOf = h => h.note === 'executed' ? 'approved' : h.note === 'mode_heli' ? 'mode' : h.note === 'decision_reopened' || h.note === 'reopened_never_dispatched' ? 'reopen' : h.status;
    const descOf = (h, st) => st === 'pending' ? t('rpt.d.pending', { n: items.length }) : st === 'assigned' ? t('rpt.d.assigned', { src: r.source ? partyName(r.source) : '—' })
      : st === 'approved' ? t('rpt.d.approved', { ship: r.dispatchOpId || '—' }) : st === 'delivered' ? t('rpt.d.delivered') : st === 'rejected' ? (h.note ? t('rpt.d.rejected', { r: h.note }) : '')
      : dict[`hist.${h.note}`] ? t(`hist.${h.note}`) : '';
    const history = (r.history || []).map(h => ({ ...h, stage: stageOf(h) }));
    const eta = r.status === 'approved' && r.departAt && r.eta ? r.departAt + r.eta * 3600000 : null;
    return { ...base,
      title: r.kind === 'base' ? L('baseReqTitle') : L('reqTitle'), subtitle: L('reqSub'),
      status: { label: statusText(r.status), tone: rptTone(r.status) },
      meta: [{ label: L('number'), value: number }, { label: L('opNumber'), value: r.id }, { label: L('opType'), value: r.kind === 'base' ? L('opTypeBase') : L('opTypeRequest') },
        { label: L('created'), value: rptDate(report.createdAt, lang) }, { label: L('entity'), value: unitOf(r) }, { label: L('priority'), value: r.priority ? t(`priority.${r.priority}`) : '—' }],
      summary: summary.length ? summary : [t('rpt.autoReq', { id: r.id, unit: unitOf(r), n: items.length, status: statusText(r.status) })],
      kpis: [{ label: L('kItems'), value: fmtQty(items.length) },
        measures.size === 1 ? { label: L('kQty'), value: qtyText(items[0]?.resource, reqTotal) } : { label: L('kOps'), value: fmtQty(s.total || 0) },
        { label: L('kAlloc'), value: r.approvedItems?.length && reqTotal ? `${Math.round(allocTotal / reqTotal * 100)}%` : '—' },
        { label: L('kDecision'), value: dur(decided) }],
      sections: [
        { type: 'fields', title: L('s.data'), sub: L('s.dataSub'), fields: [
          { label: L('f.by'), value: r.by || '—' }, { label: L('f.source'), value: r.source ? partyName(r.source) : '—' },
          { label: L('f.dest'), value: r.destination ? partyName(r.destination) : unitOf(r) },
          r.deliveredAt ? { label: L('f.delivered'), value: rptDate(r.deliveredAt, lang) } : { label: L('f.eta'), value: eta ? rptDate(eta, lang) : '—' },
          { label: L('f.mode'), value: modeText(r.mode) }, { label: L('f.shipment'), value: r.dispatchOpId || '—' },
          ...(r.decidedBy ? [{ label: L('f.decidedBy'), value: r.decidedBy }] : []), ...(r.route?.km ? [{ label: L('f.distance'), value: `${fmtQty(Math.round(r.route.km))} km` }] : [])] },
        { type: 'table', title: L('s.items'), sub: L('s.itemsSub'), columns: [L('c.item'), L('c.requested'), L('c.allocated'), L('c.dispatched'), L('c.delivered'), L('c.unit')], numeric: [1, 2, 3, 4],
          rows: items.map(i => [resName(t, i.resource), fmtQty(i.qty), alloc[i.resource] != null ? fmtQty(alloc[i.resource]) : '—', sent[i.resource] != null ? fmtQty(sent[i.resource]) : '—', got[i.resource] != null ? fmtQty(got[i.resource]) : '—', resUnitName(t, i.resource)]) },
        { type: 'timeline', title: L('s.timeline'), sub: L('s.timelineSub'), events: history.map((h, i) => ({ title: t(`rpt.stage.${i > 0 && h.stage === 'pending' ? 'reopen' : h.stage}`), desc: [descOf(h, h.stage), h.by ? `${L('by')}: ${h.by}` : ''].filter(Boolean).join(' · '), time: rptShort(h.at) })) },
        { type: 'table', title: L('s.approvals'), sub: L('s.approvalsSub'), columns: [L('c.stage'), L('c.name'), L('c.decision'), L('c.time')],
          rows: history.filter(h => ['assigned', 'approved', 'rejected', 'delivered', 'reopen'].includes(h.stage)).map(h => [t(`rpt.stage.${h.stage}`), h.by || '—', t(`rpt.dec.${h.stage}`), rptShort(h.at)]) },
        notesSec([...(r.notes ? [r.notes] : []), ...(r.rejectReason ? [`${L('rejectReason')}: ${r.rejectReason}`] : []), ...(r.comments || []).filter(c => c.text && c.kind !== 'reject').map(c => `${c.by}: ${c.text}`)]),
        recsSec, qaSec] };
  }

  // تقرير عمليات (عدة عمليات أو فترة)
  const typeLabel = type => t(`${['dispatch', 'delivery', 'transfer', 'external_add', 'return', 'consumption'].includes(type) ? 'mv.type' : 'audit'}.${type}`);
  const qtyKeys = [...new Set([...Object.keys(s.requested || {}), ...Object.keys(s.rejectedRequested || {}), ...Object.keys(s.quantities || {})])];
  const delivered = (s.requestStatus || {}).delivered || 0;
  return { ...base,
    title: L('opsTitle'), subtitle: report.selectionText || L('opsSub'), status: null,
    meta: [{ label: L('number'), value: number }, { label: L('scope'), value: report.selectionText || '—' }, { label: L('opsCount'), value: fmtQty(s.total || 0) },
      { label: L('created'), value: rptDate(report.createdAt, lang) }, { label: L('period'), value: s.firstAt ? `${rptShort(s.firstAt)} ${lang === 'en' ? '→' : '←'} ${rptShort(s.lastAt)}` : '—' }, { label: L('author'), value: me?.username || '—' }],
    summary: summary.length ? summary : [t('rpt.autoOps', { n: fmtQty(s.total || 0), r: fmtQty(s.requestCount || 0) })],
    kpis: [{ label: L('kOps'), value: fmtQty(s.total || 0) }, { label: L('kRequests'), value: fmtQty(s.requestCount || 0) }, { label: L('kDelivered'), value: fmtQty(delivered) }, { label: L('kEntities'), value: fmtQty(s.entities?.length || 0) }],
    sections: [
      { type: 'table', title: L('s.types'), sub: L('s.typesSub'), columns: [L('c.type'), L('c.count')], numeric: [1],
        rows: [...Object.entries(s.byType || {}).sort((a, b) => b[1] - a[1]).map(([k, n]) => [typeLabel(k), fmtQty(n)]), ...Object.entries(s.requestActions || {}).map(([a, n]) => [`${typeLabel('requests')} — ${t(`audit.action.${a}`)}`, fmtQty(n)])] },
      { type: 'table', title: L('s.qty'), sub: L('s.qtySub'), columns: [L('c.item'), L('c.requested'), L('c.rejected'), L('c.dispatched'), L('c.delivered'), L('c.unit')], numeric: [1, 2, 3, 4],
        rows: qtyKeys.map(k => { const v = x => x != null ? fmtQty(x) : '—'; return [resName(t, k), v(s.requested?.[k]), v(s.rejectedRequested?.[k]), v(s.quantities?.[k]?.byType?.dispatch), v(s.quantities?.[k]?.byType?.delivery), resUnitName(t, k)]; }) },
      { type: 'table', title: L('s.requests'), sub: data?.requestTotal > reqs.length ? t('rpt.s.requestsMore', { n: reqs.length, total: data.requestTotal }) : L('s.requestsSub'), columns: [L('c.request'), L('entity'), L('priority'), L('c.status'), L('c.itemsN'), L('created')], numeric: [4],
        rows: reqs.map(x => [x.id, unitOf(x), x.priority ? t(`priority.${x.priority}`) : '—', statusText(x.status), fmtQty((x.items || []).length), rptShort(x.createdAt)]) },
      { type: 'timeline', title: L('s.timeline'), sub: data?.total > (data?.timeline || []).length ? t('rpt.s.timelineMore', { n: data.timeline.length, total: data.total }) : L('s.timelineOpsSub'),
        events: (data?.timeline || []).map(e => ({ title: e.type === 'requests' ? `${e.requestId || ''} — ${t(`audit.action.${e.action}`)}` : `${typeLabel(e.type)}${e.requestId ? ` — ${e.requestId}` : ''}`,
          desc: [e.resource ? `${resName(t, e.resource)}: ${qtyText(e.resource, e.qty)}` : '', e.from || e.to ? `${e.from || '—'} ${lang === 'en' ? '→' : '←'} ${e.to || '—'}` : '', e.by ? `${L('by')}: ${e.by}` : ''].filter(Boolean).join(' · '), time: rptShort(e.at) })) },
      { type: 'table', title: L('s.parties'), sub: L('s.partiesSub'), columns: [L('c.party'), L('c.count')], numeric: [1],
        rows: [...(s.entities || []).map(e => [nodeOf(e.id) ? nodeName(nodeOf(e.id), t) : e.name, fmtQty(e.count)]), ...(s.actors || []).map(a => [`${L('by')}: ${a.by === 'simulation' ? t('mv.simulation') : a.by === 'system' ? t('req.system') : a.by}`, fmtQty(a.count)])] },
      notesSec([]), recsSec, qaSec] };
}
