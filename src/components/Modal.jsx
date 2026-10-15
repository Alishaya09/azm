// النافذة المنبثقة العامة
function Modal({ title, onClose, children, wide = false, actions = null }) {
  const { t } = useLang();
  useEffect(() => { const k = e => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, []);
  return <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}>
    <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true"><header><h3>{title}</h3><div className="modal-actions">{actions}<button type="button" className="modal-close" onClick={onClose} aria-label={t('common.close')}>✕</button></div></header><div className="modal-body">{children}</div></div>
  </div>;
}
