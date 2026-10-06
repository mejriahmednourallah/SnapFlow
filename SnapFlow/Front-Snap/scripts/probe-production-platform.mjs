// Real Apache -> production Supabase checks. Private runtime path is explicit.
import { createClient } from '@supabase/supabase-js';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
const runtime = process.env.SNAPFLOW_RUNTIME;
assert.ok(runtime, 'SNAPFLOW_RUNTIME must point to the private rehearsal directory');
const env = Object.fromEntries((await readFile(`${runtime}/runtime.env`, 'utf8')).split(/\r?\n/)
  .filter(l => l && !l.startsWith('#')).map(l => { const i=l.indexOf('='); return [l.slice(0,i),l.slice(i+1)]; }));
const login = JSON.parse(await readFile(`${runtime}/local-login.private.json`, 'utf8'));
// Node 20 needs an explicit transport; browsers use their native WebSocket.
const options = { auth: { persistSession:false, autoRefreshToken:false }, realtime:{transport:WebSocket} };
const admin = createClient(login.supabase_url, env.ANON_KEY, options);
const service = createClient(login.supabase_url, env.SERVICE_ROLE_KEY, options);
const ok = r => { assert.equal(r.error, null, r.error?.message); return r.data; };
const checks=[]; const unique=randomUUID(); let notification, bucket, signupUser, channel;
const realtimeTiming={};
async function within(promise, message, milliseconds=10000) {
  let timer;
  try { return await Promise.race([promise,new Promise((_,reject)=>{
    timer=setTimeout(()=>reject(new Error(message)),milliseconds);
  })]); } finally { clearTimeout(timer); }
}
try {
  ok(await admin.auth.signInWithPassword({email:login.email,password:login.password}));
  await admin.realtime.setAuth((await admin.auth.getSession()).data.session.access_token);
  const started=performance.now();
  let joinedResolve, postgresResolve, postgresReject;
  const joined = new Promise(resolve => { joinedResolve=resolve; });
  const postgresReady=new Promise((resolve,reject)=>{ postgresResolve=resolve; postgresReject=reject; });
  postgresReady.catch(()=>{});
  const ready = new Promise((resolve,reject) => {
    channel=admin.channel(`rehearsal-${unique}`).on('postgres_changes',{
      event:'INSERT',schema:'public',table:'notifications',filter:`user_id=eq.${login.user_id}`
    },p => { if(p.new.message===unique && p.new.user_id===login.user_id) {
      realtimeTiming.event_ms=Math.round(performance.now()-started); resolve('change');
    } }).on('system',{},p=>{
      if(p.extension!=='postgres_changes') return;
      if(p.status==='ok') {
        realtimeTiming.postgres_ready_ms=Math.round(performance.now()-started); postgresResolve();
      } else if(p.status==='error') postgresReject(new Error('PostgreSQL subscription failed'));
    });
    channel.subscribe(status => {
      if(status==='SUBSCRIBED') {
        realtimeTiming.websocket_join_ms=Math.round(performance.now()-started); joinedResolve();
      }
      if(status==='CHANNEL_ERROR' || status==='TIMED_OUT') reject(new Error(`Realtime ${status}`));
    });
  });
  ready.catch(()=>{}); // Attach immediately while waiting for the join below.
  await within(joined,'Realtime websocket did not join through Apache');
  // Socket acknowledgement precedes database readiness on cold tenants.
  // Use the producer event without sleeping or retrying the INSERT.
  await within(postgresReady,'PostgreSQL change subscription never became ready');
  realtimeTiming.insert_ms=Math.round(performance.now()-started);
  notification=ok(await service.from('notifications').insert({user_id:login.user_id,title:'Owned rehearsal',message:unique}).select('id').single());
  assert.equal(await within(ready,'Notification event timeout'),'change');
  checks.push('Authenticated notification INSERT delivered over Apache Realtime websocket');
  bucket=`rehearsal-${unique}`;
  ok(await service.storage.createBucket(bucket,{public:false}));
  ok(await service.storage.from(bucket).upload('owned.txt',Buffer.from(`SnapFlow ${unique}`),{contentType:'text/plain'}));
  const signed=ok(await service.storage.from(bucket).createSignedUrl('owned.txt',60));
  assert.equal(new URL(signed.signedUrl).origin,login.supabase_url);
  const object=await fetch(signed.signedUrl); assert.equal(object.status,200);
  assert.equal(await object.text(),`SnapFlow ${unique}`);
  checks.push('New private Storage upload and signed download work on the frontend origin');
  const anonymous=await fetch(`${login.supabase_url}/functions/v1/fetch-audit-api`,{
    method:'POST',headers:{apikey:env.ANON_KEY,Authorization:`Bearer ${env.ANON_KEY}`,'Content-Type':'application/json'},body:'{}'});
  assert.equal(anonymous.status,401);
  assert.equal((await fetch(`${login.supabase_url}/functions/v1/seed-users`)).status,403);
  checks.push('Private Edge function rejects anonymous API key; seed-users blocked');
  const email=`mail-${unique}@snapflow.local`;
  const anonymousClient=createClient(login.supabase_url,env.ANON_KEY,options);
  const signedUp=ok(await anonymousClient.auth.signUp({email,password:`${unique}!Aa9`}));
  signupUser=signedUp.user?.id; assert.ok(signupUser); assert.equal(signedUp.session,null);
  let messages;
  for(let i=0;i<30;i++) {
    messages=await (await fetch('http://127.0.0.1:18025/api/v1/messages')).json();
    if(messages.messages?.some(m=>m.To?.some(t=>t.Address===email))) break;
    await new Promise(r=>setTimeout(r,200));
  }
  const mail=messages.messages?.find(m=>m.To?.some(t=>t.Address===email));
  assert.ok(mail,'Signup mail never reached rehearsal SMTP');
  const detail=await (await fetch(`http://127.0.0.1:18025/api/v1/message/${mail.ID}`)).json();
  const links=(detail.HTML || detail.Text || '').match(/https?:\/\/[^\s<>"']+/g) || [];
  const verification=links.map(link=>link.replaceAll('&amp;','&')).find(link=>new URL(link).pathname.endsWith('/verify'));
  assert.ok(verification,'Signup mail has no verification link');
  assert.equal(new URL(verification).origin,login.supabase_url);
  assert.equal(new URL(verification).pathname,'/auth/v1/verify');
  const confirmed=await fetch(verification,{redirect:'manual'});
  assert.ok([302,303].includes(confirmed.status),'Mail confirmation did not redirect successfully');
  const passwordLogin=ok(await anonymousClient.auth.signInWithPassword({email,password:`${unique}!Aa9`}));
  assert.ok(passwordLogin.session);
  checks.push('Signup confirmation mail targets the public Auth route; clicking it enables password login');
  const artifact={assertions:'passed',checks,realtimeTiming,scope:'Production Supabase images, restored schema, real Auth/Realtime/Storage/Edge/SMTP through one Apache HTTP origin. VPS TLS, external SMTP and old Storage bytes are separate.'};
  await writeFile(new URL('../../output/capacity-study/production-platform.json',import.meta.url),JSON.stringify(artifact,null,2));
  console.log(JSON.stringify(artifact));
} finally {
  if(channel) await admin.removeChannel(channel);
  if(notification) ok(await service.from('notifications').delete().eq('id',notification.id));
  if(bucket) { await service.storage.from(bucket).remove(['owned.txt']); await service.storage.deleteBucket(bucket); }
  if(signupUser) ok(await service.auth.admin.deleteUser(signupUser));
}
