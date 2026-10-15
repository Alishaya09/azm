// لا يعمل تلقائياً: الفحص قراءة فقط، والتطبيق والاسترجاع يتطلبان اختياراً صريحاً وخادماً متوقفاً.
import { resolve } from 'node:path';
const args=process.argv.slice(2),value=name=>args[args.indexOf(name)+1];
const allowed=new Set(['--inspect','--apply','--restore','--recover','--confirm','--data-dir']);
try {
  for(let i=0;i<args.length;i++) {if(!allowed.has(args[i]))throw new Error('unknown_argument');if(['--restore','--confirm','--data-dir'].includes(args[i])){if(!args[++i]||args[i].startsWith('--'))throw new Error('missing_argument');}}
  const modes=['--inspect','--apply','--restore','--recover'].filter(m=>args.includes(m));
  const flags=args.filter(a=>a.startsWith('--'));if(new Set(flags).size!==flags.length)throw new Error('duplicate_argument');
  if(modes.length!==1)throw new Error('choose_exactly_one_mode');
  if(args.includes('--data-dir'))process.env.AZM_DATA_DIR=resolve(value('--data-dir'));
  const {DATA_DIR,SCHEMA_VERSION}=await import('../server/config.mjs');
  const {inspectCycle,startNewCycle,restoreCycle,recoverCycle}=await import('../server/store/cycle.mjs');
  let result;
  if(modes[0]==='--inspect')result=inspectCycle(DATA_DIR).summary;
  else {
    const expected=modes[0]==='--apply'?'NEW-CYCLE':modes[0]==='--restore'?'RESTORE':'RECOVER';
    if(value('--confirm')!==expected||!args.includes('--confirm'))throw new Error(`confirmation_required_${expected}`);
    result=modes[0]==='--apply'?startNewCycle(DATA_DIR,SCHEMA_VERSION):modes[0]==='--restore'?restoreCycle(DATA_DIR,value('--restore')):recoverCycle(DATA_DIR);
  }
  console.log(JSON.stringify(result,null,2));
} catch(e) {console.error(`AZM cycle: ${e.code==='EEXIST'?'unfinished_cycle_run_recover':e.message}`);process.exitCode=1;}
