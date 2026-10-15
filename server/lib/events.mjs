// إشعارات إبطال النسخة المعروضة فقط؛ لا تحمل حسابات أو بيانات عمليات أو معرّفات كيانات.
const stateListeners = new Set();
export const onStateSaved = listener => { stateListeners.add(listener); return () => stateListeners.delete(listener); };
export const notifyStateSaved = () => { for (const listener of stateListeners) listener(); };
