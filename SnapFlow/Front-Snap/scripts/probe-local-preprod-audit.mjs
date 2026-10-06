// Real Edge Function submission, PostgreSQL admission and packaged pipeline.
import { createClient } from '@supabase/supabase-js';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const login = JSON.parse(await readFile(process.env.SNAPFLOW_LOGIN_FILE || new URL('../supabase/.local-login.json', import.meta.url), 'utf8'));
const env = Object.fromEntries((await readFile(process.env.SNAPFLOW_ENV_FILE || new URL('../supabase/.env.local', import.meta.url), 'utf8')).split(/\r?\n/)
  .filter(line => line && !line.startsWith('#')).map(line => { const i = line.indexOf('='); return [line.slice(0,i),line.slice(i+1)]; }));
const client = createClient(login.supabase_url, env.SUPABASE_ANON_KEY || env.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const databaseContainer = process.env.SNAPFLOW_AUDIT_DB_CONTAINER || 'snapflow-local-preprod-db-1';
const apiOrigin = process.env.SNAPFLOW_AUDIT_API_ORIGIN || 'http://127.0.0.1:8080';
const artifactPrefix = process.env.SNAPFLOW_ARTIFACT_PREFIX || 'preprod';
const ok = r => { assert.equal(r.error,null,r.error?.message); return r.data; };
ok(await client.auth.signInWithPassword({ email: login.email, password: login.password }));
const audits = ok(await client.from('audits').select('id,job_id,status').eq('project_id', login.demo_project.id).order('created_at',{ascending:false}).limit(1));
assert.ok(audits[0]?.job_id, 'Start the first audit in the real frontend before this probe');
const first = audits[0].job_id;
const submission = ok(await client.functions.invoke('fetch-audit-api', { body: { url:'http://preprod-fixture:18991/', async_mode:true, max_pages:6 } }));
assert.ok(submission.job_id, JSON.stringify(submission));
const second = submission.job_id;
assert.ok(/^scan_[a-f0-9]+$/.test(first) && /^scan_[a-f0-9]+$/.test(second));
const samples = [], start = Date.now();
let completed = false;
for (let attempt=0; attempt<300; attempt++) {
  const sql = `SELECT COALESCE(json_agg(json_build_object('scan_id',scan_id,'status',lower(state_json->>'status'))),'[]') FROM scan_state;`;
  const states = JSON.parse(execFileSync('docker',['exec',databaseContainer,'psql','-X','-U','snapflow','-d','snapflow_v3','-Atc',sql],{encoding:'utf8',timeout:10000}).trim());
  const active = states.filter(s=>['running','nlp_processing'].includes(s.status));
  assert.ok(active.length<=1, JSON.stringify(states));
  samples.push({ seconds:(Date.now()-start)/1000, active:active.length, states });
  const ours=states.filter(s=>[first,second].includes(s.scan_id));
  assert.ok(ours.every(s=>s.status!=='failed'), JSON.stringify(ours));
  if (ours.length===2 && ours.every(s=>s.status==='complete')) { completed=true; break; }
  await new Promise(resolve=>setTimeout(resolve,2000));
}
assert.ok(completed,'Both actual audits must complete within this probe window');
assert.ok(samples.some(s=>s.states.some(x=>x.scan_id===second && x.status==='pending') &&
  s.states.some(x=>x.scan_id===first && ['running','nlp_processing'].includes(x.status))),
  'Second audit was never observed waiting while the first was active');
const reports=[];
for(const id of [first,second]) {
  const evidenceSql = `SELECT json_agg(json_build_object('url',url,'current_nlp',nlp_revision=content_revision,'rendered',rendered_html IS NOT NULL)) FROM scan_pages WHERE scan_id='${id}';`;
  const pages = JSON.parse(execFileSync('docker',['exec',databaseContainer,'psql','-X','-U','snapflow','-d','snapflow_v3','-Atc',evidenceSql],{encoding:'utf8',timeout:10000}).trim());
  assert.equal(pages.length,6,'All six independently specified routes must reach the report');
  assert.ok(pages.every(p=>p.current_nlp && p.rendered), 'Every fixture route must have current rendered NLP');
  const r=await fetch(`${apiOrigin}/scan/${id}/kpis`); assert.equal(r.status,200);
  const report=await r.json(); assert.equal(report.kpi_mode,'new'); assert.ok(report.axes);
  const again=await (await fetch(`${apiOrigin}/scan/${id}/kpis`)).json();
  assert.deepEqual(again,report,'Persisted report reload changed');
  await writeFile(new URL(`../../output/capacity-study/${artifactPrefix}-${id}-report.json`,import.meta.url),JSON.stringify(report,null,2));
  reports.push({ scan_id:id, pages, axes:Object.keys(report.axes), persisted_reload_identical:true });
}
const artifact={ assertions:'passed', first_scan:first, second_scan:second, frontend_audit_id:audits[0].id,
  second_budget:6, reports, admission_samples:samples,
  scope:'Actual frontend first submission, actual Supabase Edge second submission, PostgreSQL admission, scanner/browser/NLP/aggregation and persisted reload; small local fixture, not VPS capacity acceptance.' };
await writeFile(new URL(`../../output/capacity-study/${artifactPrefix}-audit.json`,import.meta.url),JSON.stringify(artifact,null,2));
console.log(JSON.stringify({ assertions:artifact.assertions, first,second,reports, samples:samples.length, seconds:(Date.now()-start)/1000 }));
