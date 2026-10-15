// الخريطة التكتيكية (Leaflet): العرض والتعديل والقوافل
function TacticalMap({ units, convoys=[], serverLayout, simClock = () => 0, onSaveLayout, onChanged = null, canEdit = false, myUnitId = null, requests = [], onRequest = null, onOpenRequest = null, depots = {}, inventory = {}, hierarchy = {}, mapOthers = [] }) {
  const { t, lang } = useLang();
  const [selected, setSelected] = useState(null);
  const el = useRef(null), mapRef = useRef(null), tiles = useRef({}), layerCtrl = useRef(null);
  const layoutLayer = useRef(null), convoyLayer = useRef(null), markers = useRef({}), convoyMarkers = useRef({}), dragging = useRef(false), routing = useRef(new Set());
  const [layout, setLayout] = useState(() => normalizeLayout(serverLayout?.layout)), [editing, setEditing] = useState(false), [tool, setTool] = useState(null);
  const [linkKind, setLinkKind] = useState('road'), [linkFrom, setLinkFrom] = useState(null), [creating, setCreating] = useState(null), [mapError, setMapError] = useState(null);
  // رقم نسخة التخطيط اللي بُنيت عليها التعديلات المحلية — الخادم يرفض الحفظ (409) إذا تغيّرت الخريطة من بعدها
  const verRef = useRef(serverLayout?.version ?? null), saveChain = useRef(Promise.resolve());
  // مراجع لأحدث القيم حتى تقرأها معالجات أحداث Leaflet
  const live = useRef({}); live.current = { editing, tool, linkKind, linkFrom, units, layout, t, onSaveLayout, myUnitId, simClock, selected };
  // أي فشل في الحفظ: نعرض السبب ونرجع لنسخة الخادم
  const failed = e => { setMapError(e); setEditing(false); setTool(null); setLinkFrom(null); onChanged?.(); };
  // الحفظ بالتسلسل حتى كل طلب يحمل رقم النسخة اللي رجعت من اللي قبله
  const update = fn => setLayout(v => { const next = fn(v); if (next !== v) saveChain.current = saveChain.current.then(() => live.current.onSaveLayout?.(next, verRef.current).then(ver => { verRef.current = ver; }).catch(failed)); return next; });

  // تحديثات التخطيط من الخادم (تعديلات القائد) — لا نطبّقها أثناء التعديل حتى لا تضيع التغييرات
  useEffect(() => { if (!editing && serverLayout) { setLayout(normalizeLayout(serverLayout.layout)); verRef.current = serverLayout.version; } }, [serverLayout, editing]);
  // ترحيل تخطيط محفوظ محلياً من قبل إلى الخادم مرة واحدة
  useEffect(() => { if (canEdit && serverLayout && !serverLayout.layout) { const legacy = takeLegacyLayout(); if (legacy) { setLayout(legacy); onSaveLayout?.(legacy); } } }, [canEdit, serverLayout?.version]);

  // حساب المسار الفعلي على الطرق لكل رابط بري ما له مسار محفوظ (عند المسؤول فقط، والنتيجة تنحفظ للجميع)
  useEffect(() => {
    if (!canEdit) return;
    const byId = Object.fromEntries(layout.nodes.map(n => [n.id, n]));
    layout.links.forEach(l => {
      const a = byId[l.from]?.pos, b = byId[l.to]?.pos; if (l.kind !== 'road' || l.geometry || !a || !b) return;
      const sig = `${l.id}:${a}:${b}`; if (routing.current.has(sig)) return; routing.current.add(sig);
      fetchRoadRoute(a, b).then(r => ({ ...r, approx: false })).catch(() => ({ geometry: [a, b], km: Math.round(haversineKm(a, b) * 13) / 10, approx: true }))
        .then(res => { routing.current.delete(sig); update(v => {
          const na = v.nodes.find(n => n.id === l.from)?.pos, nb = v.nodes.find(n => n.id === l.to)?.pos;
          if (`${l.id}:${na}:${nb}` !== sig || !v.links.some(x => x.id === l.id)) return v;
          return { ...v, links: v.links.map(x => x.id === l.id ? { ...x, ...res } : x) };
        }); });
    });
  }, [layout, canEdit]);

  const onMapClick = latlng => {
    const { editing, tool, t } = live.current; if (!editing || !tool) setSelected(null);
    if (!editing || !['main', 'fsb', 'unit'].includes(tool)) return;
    // الإنشاء من نافذة تطلب التبعية (إلزامية) والرصيد الافتتاحي، والخادم ينشئ النقطة وسجلاتها فوراً
    setCreating({ type: tool, pos: [+latlng.lat.toFixed(5), +latlng.lng.toFixed(5)] });
  };
  // كيان انضاف على الخادم: نضيفه للخريطة المحلية بدون حفظ ثاني
  const onCreated = r => { setLayout(v => ({ ...v, nodes: [...v.nodes, r.node] })); verRef.current = r.layoutVersion; onChanged?.(); };
  // تعديل التبعية من بطاقة النقطة (الخادم يحفظ مباشرة)
  const onRelationChanged = r => { if (r?.node) setLayout(v => ({ ...v, nodes: v.nodes.map(n => n.id === r.node.id ? r.node : n) })); if (r?.layoutVersion) verRef.current = r.layoutVersion; onChanged?.(); };
  // تقريب تدريجي للنقطة المختارة، مع إزاحتها يمين المنتصف عشان بطاقة البيانات (يسار الخريطة) ما تغطيها
  const focusNode = n => {
    const m = mapRef.current; if (!m || !n) return;
    const z = Math.max(m.getZoom(), 9), offset = el.current.clientWidth > 700 ? 180 : 0;
    m.flyTo(m.unproject(m.project(n.pos, z).subtract([offset, 0]), z), z, { duration: 1.2, easeLinearity: .2 });
  };
  const onNodeClick = id => {
    const { editing, tool, linkKind, linkFrom, t, layout } = live.current;
    if (!editing || !tool) { const pick = live.current.selected !== id; setSelected(pick ? id : null); if (pick) focusNode(layout.nodes.find(x => x.id === id)); return; }
    if (tool === 'delete') {
      // الحذف = أرشفة على الخادم (يرفض إذا عليها طلبات نشطة أو شحنات أو لها توابع) — التاريخ والرصيد يبقون محفوظين
      const n = layout.nodes.find(x => x.id === id); if (!n) return;
      if (n.type === 'hq') return setMapError({ code: 'hq_locked' });
      if (!confirm(t(n.type === 'unit' ? 'map.deleteUnitConfirm' : 'map.deleteNodeConfirm', { name: nodeName(n, t) }))) return;
      setMapError(null);
      saveChain.current = saveChain.current.then(() => api(`/api/entities/${id}`, { method: 'DELETE' }).then(r => {
        setLayout(v => ({ nodes: v.nodes.filter(x => x.id !== id), links: v.links.filter(l => l.from !== id && l.to !== id) })); verRef.current = r.layoutVersion; onChanged?.();
      }).catch(setMapError));
    }
    if (tool === 'link') {
      if (!linkFrom || linkFrom === id) return setLinkFrom(linkFrom === id ? null : id);
      update(v => v.links.some(l => l.kind === linkKind && ((l.from === linkFrom && l.to === id) || (l.from === id && l.to === linkFrom))) ? v : { ...v, links: [...v.links, { id: newId('l'), from: linkFrom, to: id, kind: linkKind }] });
      setLinkFrom(null);
    }
  };
  const onNodeRename = id => {
    const { editing, tool, t } = live.current; if (!editing || tool) return;
    const n = live.current.layout.nodes.find(x => x.id === id); if (!n || n.type === 'hq') return;
    const label = prompt(t('map.renamePrompt'), nodeName(n, t)); if (label && label.trim()) update(v => ({ ...v, nodes: v.nodes.map(x => x.id === id ? { ...x, label: label.trim(), labelKey: undefined } : x) }));
  };
  const onLinkClick = id => { const { editing, tool } = live.current; if (editing && tool === 'delete') update(v => ({ ...v, links: v.links.filter(l => l.id !== id) })); };
  // عند تحريك نقطة، نمسح المسارات البرية المتصلة فيها عشان تنحسب من جديد على الطرق
  const onNodeMoved = (id, p) => update(v => ({ nodes: v.nodes.map(x => x.id === id ? { ...x, pos: [+p.lat.toFixed(5), +p.lng.toFixed(5)] } : x), links: v.links.map(l => l.from === id || l.to === id ? { ...l, geometry: undefined, km: undefined, approx: undefined } : l) }));
  const handlers = useRef({}); handlers.current = { onMapClick, onNodeClick, onNodeRename, onLinkClick, onNodeMoved };

  useEffect(() => {
    const m = L.map(el.current, { zoomControl: true, attributionControl: true, doubleClickZoom: false }).setView([22.3, 44.6], 6);
    const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 18, attribution: 'Esri' }).addTo(m);
    const dark = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19, attribution: '© OpenStreetMap © CARTO' });
    const streets = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' });
    // طبقة أسماء المدن والمناطق والحدود فوق صور القمر الصناعي
    const labels = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 18, attribution: 'Esri' }).addTo(m);
    tiles.current = { satellite, dark, streets, labels };
    m.on('baselayerchange', e => { if (e.layer === satellite) labels.addTo(m); else m.removeLayer(labels); labels.bringToFront(); });
    m.on('click', e => handlers.current.onMapClick(e.latlng));
    layoutLayer.current = L.layerGroup().addTo(m); convoyLayer.current = L.layerGroup().addTo(m); mapRef.current = m;
    return () => m.remove();
  }, []);

  // أداة تبديل الطبقات تُبنى من جديد عند تغيير اللغة لتتحدث أسماؤها
  useEffect(() => {
    const { satellite, dark, streets, labels } = tiles.current;
    if (layerCtrl.current) layerCtrl.current.remove();
    layerCtrl.current = L.control.layers({ [t('map.layer.sat')]: satellite, [t('map.layer.dark')]: dark, [t('map.layer.streets')]: streets }, { [t('map.layer.labels')]: labels }, { position: 'topleft' }).addTo(mapRef.current);
  }, [lang]);

  // رسم النقاط والمسارات عند تغيّر التخطيط أو وضع التعديل أو اللغة
  useEffect(() => {
    const g = layoutLayer.current; g.clearLayers(); markers.current = {};
    const byId = Object.fromEntries(layout.nodes.map(n => [n.id, n]));
    layout.links.forEach(l => { const a = byId[l.from], b = byId[l.to]; if (!a || !b) return;
      const waiting = l.kind === 'road' && !l.geometry;
      const tip = waiting ? t('map.routing') : `${t(l.kind === 'air' ? 'map.air' : 'map.road')} — ${Math.round(linkKm(l, byId))} ${t('common.km')}${l.approx ? t('map.approx') : ''}`;
      const style = waiting ? 'pending' : linkStyle[l.kind] ? l.kind : 'road', line = waiting ? [a.pos, b.pos] : l.geometry || [a.pos, b.pos];
      L.polyline(line, { color: linkGlow[style], weight: 10, opacity: .28, interactive: false, className: 'azm-link-glow' }).addTo(g);
      L.polyline(line, linkStyle[style])
        .bindTooltip(escapeHtml(tip), { sticky: true })
        .on('click', e => { L.DomEvent.stopPropagation(e); handlers.current.onLinkClick(l.id); }).addTo(g); });
    layout.nodes.forEach(n => {
      const mk = L.marker(n.pos, { icon: nodeIcon(n, live.current.units, n.id === linkFrom ? 'picked' : n.id === selected ? 'selected' : '', myUnitId), draggable: editing && !tool && n.type !== 'hq', zIndexOffset: n.type === 'unit' ? 500 : 0 })
        .bindTooltip(escapeHtml(nodeLabel(n, live.current.units, t, myUnitId)))
        .on('click', e => { L.DomEvent.stopPropagation(e); handlers.current.onNodeClick(n.id); })
        .on('dblclick', e => { L.DomEvent.stopPropagation(e); handlers.current.onNodeRename(n.id); })
        .on('dragstart', () => { dragging.current = true; })
        .on('dragend', e => { dragging.current = false; handlers.current.onNodeMoved(n.id, e.target.getLatLng()); })
        .addTo(g);
      markers.current[n.id] = mk;
    });
    // قواعد ووحدات خارج النطاق (لمسؤول القاعدة): الاسم فقط، بلا حالة ولا بيانات ولا تفاعل
    mapOthers.forEach(n => {
      L.marker(n.pos, { icon: mapIcon(`${n.type} other names-only`, n.type === 'unit' ? escapeHtml(String(n.unitId || '').slice(-2)) : '★'), interactive: true, keyboard: false, zIndexOffset: n.type === 'unit' ? 400 : 0 })
        .bindTooltip(escapeHtml(`${nodeName(n, t)} — ${t('map.namesOnly')}`)).addTo(g);
    });
  }, [layout, editing, tool, linkFrom, lang, myUnitId, selected, mapOthers]);

  // تحديث ألوان الوحدات مع المحاكاة دون إعادة رسم الخريطة
  useEffect(() => {
    if (!dragging.current) layout.nodes.filter(n => n.type === 'unit').forEach(n => { const mk = markers.current[n.id]; if (mk) { mk.setIcon(nodeIcon(n, units, n.id === linkFrom ? 'picked' : n.id === selected ? 'selected' : '', myUnitId)); mk.setTooltipContent(escapeHtml(nodeLabel(n, units, t, myUnitId))); } });
  }, [units, layout, linkFrom, lang, selected]);

  // القوافل المعتمدة: نرسم مسارها ونحرّك أيقونتها (🚛 أو ✈️) من نقطة التوريد إلى الوحدة
  const convoyKey = convoys.filter(c => c.route?.path?.length).map(c => `${c.id}:${c.mode}:${c.departSim}`).join('|');
  useEffect(() => {
    const g = convoyLayer.current; g.clearLayers(); convoyMarkers.current = {};
    convoys.forEach(c => { if (!c.route?.path?.length) return;
      L.polyline(c.route.path, { color: '#f3a83c', weight: 4, opacity: .9, dashArray: c.mode === 'heli' ? '2 8' : null, interactive: false }).addTo(g);
      const mk = L.marker(c.route.path[0], { icon: mapIcon(`convoy-icon ${c.mode}`, c.mode === 'heli' ? '✈️' : '🚛'), zIndexOffset: 1000 }).bindTooltip('').addTo(g);
      convoyMarkers.current[c.id] = { mk, c };
    });
    const tick = () => {
      const now = live.current.simClock(), { t } = live.current;
      Object.values(convoyMarkers.current).forEach(({ mk, c }) => { const p = convoyProgress(c, now); mk.setLatLng(pointAlong(c.route.path, p)); mk.setTooltipContent(escapeHtml(`${c.id} — ${t(`mode.${c.mode}`)} — ${Math.round(p * 100)}%`)); });
    };
    tick(); const id = setInterval(tick, 100); return () => clearInterval(id);
  }, [convoyKey, lang]);

  const pickTool = id => { setTool(tool === id ? null : id); setLinkFrom(null); };
  return <div className={`map-panel ${editing && ['main', 'fsb', 'unit'].includes(tool) ? 'placing' : ''}`}><div className="leaflet-map" ref={el} dir="ltr"/>
  {canEdit && <div className="map-editor">
    <button className={editing ? 'active' : ''} onClick={() => { setEditing(!editing); setTool(null); setLinkFrom(null); setMapError(null); }}>{editing ? t('map.done') : t('map.edit')}</button>
    {editing && <>
      <div className="tools">{mapTools.map(id => <button key={id} className={tool === id ? 'active' : ''} onClick={() => pickTool(id)}>{t(`map.tool.${id}`)}</button>)}</div>
      {tool === 'link' && <div className="tools"><button className={linkKind === 'road' ? 'active' : ''} onClick={() => setLinkKind('road')}>{t('map.road')}</button><button className={linkKind === 'air' ? 'active' : ''} onClick={() => setLinkKind('air')}>{t('map.air')}</button></div>}
      <small>{tool === 'link' && linkFrom ? t('map.hint.second') : t(`map.hint.${tool || 'none'}`)}</small>
    </>}
  </div>}
  {mapError && <div className="map-error" onClick={() => setMapError(null)}>⚠ {errText(t, mapError)}</div>}
  {creating && <CreateEntityModal type={creating.type} pos={creating.pos} layout={layout} onClose={() => setCreating(null)} onCreated={onCreated}/>}
  {selected && layout.nodes.some(n => n.id === selected) && <NodeInfo node={layout.nodes.find(n => n.id === selected)} layout={layout} units={units} convoys={convoys} requests={requests} myUnitId={myUnitId} simClock={simClock} depots={depots} inventory={inventory} hierarchy={hierarchy} canEdit={canEdit} onRelationChanged={onRelationChanged} onClose={() => setSelected(null)} onOpenRequest={onOpenRequest} onRequest={onRequest && (id => (!myUnitId || id === myUnitId) && onRequest(id))}/>}
  <div className="legend"><span><i className="road"/> {t('map.road')}</span><span><i className="air"/> {t('map.air')}</span><span><i className="convoy-line"/> {t('map.convoyRoute')}</span><span>⬢ {t('map.unit')}</span><span>▪ {t('map.fsb')}</span><span>★ {t('info.type.main')}</span><span><span className="legend-emblem" dangerouslySetInnerHTML={{ __html: MAIN_BASE_EMBLEM }} /> {t('map.hqShort')}</span></div></div>;
}
