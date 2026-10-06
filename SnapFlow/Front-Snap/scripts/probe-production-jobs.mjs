import { createClient } from '@supabase/supabase-js';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const runtime=process.env.SNAPFLOW_RUNTIME;
assert.ok(runtime);
const env=Object.fromEntries((await readFile(`${runtime}/runtime.env`,'utf8')).split(/\r?\n/)
  .filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)];}));
const login=JSON.parse(await readFile(`${runtime}/local-login.private.json`,'utf8'));
const options={auth:{persistSession:false,autoRefreshToken:false}};
const service=createClient(login.supabase_url,env.SERVICE_ROLE_KEY,options);
const admin=createClient(login.supabase_url,env.ANON_KEY,options);
const ok=r=>{assert.equal(r.error,null,r.error?.message);return r.data;};
ok(await admin.auth.signInWithPassword({email:login.email,password:login.password}));
let workflow, schedule, outsider; const checks=[];
const started=Date.now();
try {
  const created=ok(await service.rpc('form_test_create_workflow',{
    p_org_id:login.user_id,p_created_by:login.user_id,p_name:`Owned ${randomUUID()}`,p_target_url:'http://preprod-fixture:18991/'
  }));
  workflow=created.workflow;
  const nodes=ok(await service.from('workflow_nodes').insert([
    {workflow_id:workflow.id,scenario_id:created.scenario.id,type:'trigger',order_index:0,config:{url:workflow.target_url}},
    {workflow_id:workflow.id,scenario_id:created.scenario.id,type:'assert',order_index:1,config:{type:'text_present',value:'HOME_EVIDENCE',label:'Authored fixture marker'}}
  ]).select('id,order_index'));
  nodes.sort((a,b)=>a.order_index-b.order_index);
  ok(await service.from('workflow_edges').insert({workflow_id:workflow.id,scenario_id:created.scenario.id,source_node_id:nodes[0].id,target_node_id:nodes[1].id}));
  const execution=ok(await admin.functions.invoke('form-workflows-execute',{body:{workflow_id:workflow.id,scenario_id:created.scenario.id}}));
  let result;
  for(let i=0;i<90;i++) {
    result=ok(await service.from('workflow_results').select('id,status,progress_completed,progress_total,assertions,final_url,error_message').eq('id',execution.execution_id).single());
    if(!['queued','running','stopping'].includes(result.status)) break;
    await new Promise(r=>setTimeout(r,1000));
  }
  assert.equal(result.status,'passed',JSON.stringify(result));
  assert.ok(result.assertions.some(a=>a.passed && a.expected.includes('HOME_EVIDENCE')));
  assert.equal(result.progress_completed,2);
  checks.push('Authenticated Edge enqueue -> restored Supabase queue -> real Chromium Form Executor -> persisted two-step assertion passed');
  console.log('Owned Form Executor job passed.');
  schedule=ok(await service.from('report_schedules').insert({project_id:login.demo_project.id,created_by:login.user_id,report_type:'audit',frequency:'daily',next_run_at:new Date(Date.now()-1000).toISOString(),is_active:true}).select('id').single());
  // An authenticated non-admin must not dispatch another user's due job.
  const password=`${randomUUID()}!Aa9`;
  outsider=ok(await service.auth.admin.createUser({email:`schedule-${randomUUID()}@snapflow.local`,password,email_confirm:true})).user;
  ok(await service.from('user_roles').insert({user_id:outsider.id,role:'charge_de_projet'}));
  const other=createClient(login.supabase_url,env.ANON_KEY,options);
  ok(await other.auth.signInWithPassword({email:outsider.email,password}));
  assert.equal(ok(await other.functions.invoke('execute-scheduled-reports',{body:{}})).executed,0);
  assert.equal(ok(await service.from('report_schedules').select('current_scan_id').eq('id',schedule.id).single()).current_scan_id,null);
  checks.push('Non-admin scheduled dispatcher cannot execute another owner\'s due schedule');
  const dispatch=ok(await service.functions.invoke('execute-scheduled-reports',{body:{}}));
  assert.ok(dispatch.results?.some(r=>r.id===schedule.id && r.status==='scanning_in_progress'),JSON.stringify(dispatch));
  const running=ok(await service.from('report_schedules').select('current_scan_id,is_scanning').eq('id',schedule.id).single());
  assert.ok(running.current_scan_id && running.is_scanning);
  console.log('Owned scheduled audit started.');
  let state;
  for(let i=0;i<300;i++) {
    state=await (await fetch(`http://127.0.0.1:18081/scan/${running.current_scan_id}/status`)).json();
    if(['complete','failed','done'].includes(state.status)) break;
    await new Promise(r=>setTimeout(r,2000));
  }
  assert.ok(['complete','done'].includes(state.status),JSON.stringify(state));
  ok(await service.from('report_schedules').update({next_run_at:new Date(Date.now()-1000).toISOString()}).eq('id',schedule.id));
  ok(await service.functions.invoke('execute-scheduled-reports',{body:{}}));
  const audit=ok(await service.from('audits').select('id,status,report_data').eq('job_id',running.current_scan_id).single());
  assert.equal(audit.status,'completed'); assert.equal(audit.report_data.kpi_mode,'new');
  const finished=ok(await service.from('report_schedules').select('is_scanning,current_scan_id,last_run_at').eq('id',schedule.id).single());
  assert.equal(finished.is_scanning,false); assert.equal(finished.current_scan_id,null); assert.ok(finished.last_run_at);
  checks.push('Owned scheduled audit starts, polls completion, persists current report and returns schedule to next-run state');
  const artifact={assertions:'passed',checks,scheduled_scan:running.current_scan_id,form_status:result.status,seconds:(Date.now()-started)/1000,scope:'Real owned fixture jobs with imported schedules disabled; dispatcher invoked explicitly, not production cron/SMTP acceptance.'};
  await writeFile(new URL('../../output/capacity-study/production-jobs.json',import.meta.url),JSON.stringify(artifact,null,2));
  console.log(JSON.stringify(artifact));
} finally {
  if(schedule) await service.from('report_schedules').delete().eq('id',schedule.id);
  if(workflow) await service.from('form_workflows').delete().eq('id',workflow.id);
  if(outsider) ok(await service.auth.admin.deleteUser(outsider.id));
}
