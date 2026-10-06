"""Exercise real PostgreSQL lease renewal and ownership loss at accelerated time."""
import json
from pathlib import Path
import subprocess

code=r'''
import json,time,uuid
import psycopg2,psycopg2.extras
import page_queue as queue
import os
def connect():
 return psycopg2.connect(host=os.environ['DB_HOST'],dbname=os.environ['DB_NAME'],user=os.environ['DB_USER'],password=os.environ['DB_PASS'],connect_timeout=5)
conn=connect();cur=conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
token=str(uuid.uuid4()); row=None; heartbeat=None
try:
 cur.execute("INSERT INTO scan_pages(scan_id,domain,url,html,nlp_ready,nlp_claim_token,nlp_claim_until) VALUES('owned_lease_probe','fixture','http://fixture/lease','<p>Owned</p>',false,%s,CURRENT_TIMESTAMP+INTERVAL '3 seconds') RETURNING id,content_revision,nlp_claim_token,nlp_results,nlp_revision",(token,))
 row=cur.fetchone();conn.commit()
 queue.CLAIM_LEASE_SECONDS=3
 heartbeat=queue.ClaimHeartbeat(connect,row);heartbeat.start();time.sleep(7)
 cur.execute('SELECT nlp_claim_until > CURRENT_TIMESTAMP AS live FROM scan_pages WHERE id=%s',(row['id'],));assert cur.fetchone()['live'];conn.commit()
 new_token=str(uuid.uuid4())
 cur.execute("UPDATE scan_pages SET nlp_claim_token=%s,nlp_claim_until=CURRENT_TIMESTAMP+INTERVAL '60 seconds' WHERE id=%s RETURNING nlp_claim_until",(new_token,row['id']));deadline=cur.fetchone()['nlp_claim_until'];conn.commit();time.sleep(2)
 assert not queue.publish_page(conn,cur,row,{'word_count':999}), 'Old worker published after losing claim'
 cur.execute('SELECT nlp_claim_token,nlp_claim_until,nlp_results FROM scan_pages WHERE id=%s',(row['id'],));state=cur.fetchone();conn.commit()
 assert str(state['nlp_claim_token'])==new_token and state['nlp_claim_until']==deadline and state['nlp_results'] is None
 print(json.dumps(dict(assertions='passed',renewal_past_original_deadline=True,old_heartbeat_did_not_extend_new_owner=True,stale_publication_rejected=True,lease_seconds=3,held_seconds=7,scope='Actual PostgreSQL and production heartbeat code; accelerated lease only in this isolated probe process, runtime default 90 seconds.')))
finally:
 if heartbeat:heartbeat.stop()
 if row:cur.execute('DELETE FROM scan_pages WHERE id=%s',(row['id'],));conn.commit()
 cur.close();conn.close()
'''
result=subprocess.check_output(['docker','exec','-i','snapflow-rehearsal-snapflow-nlp-worker-1','python','-'],input=code,text=True)
artifact=json.loads(result)
target=Path(__file__).resolve().parents[2]/'output/capacity-study/production-heartbeat.json'
target.write_text(json.dumps(artifact,indent=2),encoding='utf-8')
print(result)
