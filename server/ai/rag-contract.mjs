// عقد جاهز للمسترجع القادم، دون مستندات أو بحث وهمي. يُمرر فلتر الصلاحيات قبل البحث.
import { canAccessDocument, retrievalFilter } from '../store/scope.mjs';
export const reportRetrievalContract = {
  input: { question: 'string <= 4000', filter: '{all,role,baseIds,entityIds,unitIds}', limit: 6 },
  output: '[{id:string,text:string<=4000,metadata:{baseIds?:string[],entityIds?:string[],unitIds?:string[],visibility?:"all"}}]',
  state: 'local_or_external_optional',
};
export const reportRetrievalInput = (me,question) => ({question:String(question).slice(0,4000),filter:retrievalFilter(me),limit:6});
export function validateReportChunks(me,chunks) {
  if(!Array.isArray(chunks)||chunks.length>6)return {error:'invalid_rag_result'};
  for(const c of chunks){
    if(!c||typeof c!=='object'||Object.keys(c).some(k=>!['id','text','metadata'].includes(k))||typeof c.id!=='string'||c.id.length>100||typeof c.text!=='string'||c.text.length>4000||!c.metadata||typeof c.metadata!=='object'||Array.isArray(c.metadata))return {error:'invalid_rag_result'};
    if(Object.entries(c.metadata).some(([k,v])=>!['visibility','baseIds','entityIds','unitIds'].includes(k)||(k==='visibility'?v!=='all':!Array.isArray(v)||v.length>30||v.some(id=>typeof id!=='string'||id.length>80)))||!canAccessDocument(me,c.metadata))return {error:'invalid_rag_result'};
  }
  return {chunks:chunks.map(c=>({id:c.id,text:c.text,metadata:c.metadata}))};
}
