// اختبار الإصدار v7/v8 على بيانات مؤقتة: الكتالوج المفصل، الترحيل، الصلاحيات، الحركات، المحاكاة والتقارير،
// ودورة الطلب (قرار القائد ثم مباشرة مسؤول القاعدة) وسياسة الأصناف التشغيلية.
// اختبارات v6 القديمة (فرضيات الأصناف الأربع المتقاعدة) أُزيلت؛ هذا الملف يختبر السلوك الحالي.
import './resource-v7-test.mjs';
// تشمل اختبارات v9 تعبئة المراكز: الإنشاء الذري، القديم الفارغ، التزامن، الصلاحيات وإعادة التشغيل.
await import('./bulk-transfer-test.mjs');
await import('./request-cycle-test.mjs');
await import('./supply-v9-test.mjs');
const { spawnSync } = await import('node:child_process');
const { fileURLToPath } = await import('node:url');
const v10 = spawnSync(process.execPath, [fileURLToPath(new URL('./unit-policy-v10-test.mjs', import.meta.url))], { stdio: 'inherit', windowsHide: true });
if (v10.status !== 0) throw new Error('unit-policy-v10 failed');
const cycle = spawnSync(process.execPath, [fileURLToPath(new URL('./new-cycle-test.mjs', import.meta.url))], { stdio: 'inherit', windowsHide: true });
if (cycle.status !== 0) throw new Error('new-cycle failed');
const accounts = spawnSync(process.execPath, [fileURLToPath(new URL('./user-assignment-test.mjs', import.meta.url))], { stdio: 'inherit', windowsHide: true });
if (accounts.status !== 0) throw new Error('user-assignment failed');
const roles = spawnSync(process.execPath, [fileURLToPath(new URL('./role-permissions-test.mjs', import.meta.url))], { stdio: 'inherit', windowsHide: true });
if (roles.status !== 0) throw new Error('role-permissions failed');
const assistant = spawnSync(process.execPath, [fileURLToPath(new URL('./assistant-chat-test.mjs', import.meta.url))], { stdio: 'inherit', windowsHide: true });
if (assistant.status !== 0) throw new Error('assistant-chat failed');
const assistantStream = spawnSync(process.execPath, [fileURLToPath(new URL('./assistant-stream-test.mjs', import.meta.url))], { stdio: 'inherit', windowsHide: true });
if (assistantStream.status !== 0) throw new Error('assistant-stream failed');
const assistantLocations = spawnSync(process.execPath, [fileURLToPath(new URL('./assistant-locations-test.mjs', import.meta.url))], { stdio: 'inherit', windowsHide: true });
if (assistantLocations.status !== 0) throw new Error('assistant-locations failed');
const opsReport = spawnSync(process.execPath, [fileURLToPath(new URL('./ops-report-test.mjs', import.meta.url))], { stdio: 'inherit', windowsHide: true });
if (opsReport.status !== 0) throw new Error('ops-report failed');
const aiSafety = spawnSync(process.execPath, [fileURLToPath(new URL('./ai-safety-net-test.mjs', import.meta.url))], { stdio: 'inherit', windowsHide: true });
if (aiSafety.status !== 0) throw new Error('ai-safety-net failed');
const assistantIntent = spawnSync(process.execPath, [fileURLToPath(new URL('./assistant-request-intent-test.mjs', import.meta.url))], { stdio: 'inherit', windowsHide: true });
if (assistantIntent.status !== 0) throw new Error('assistant-request-intent failed');
const reportTemplate = spawnSync(process.execPath, [fileURLToPath(new URL('./report-template-test.mjs', import.meta.url))], { stdio: 'inherit', windowsHide: true });
if (reportTemplate.status !== 0) throw new Error('report-template failed');
