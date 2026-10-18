const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const cp=require('node:child_process');

// Explicitly opt in to a disposable native PostgreSQL cluster. Never uses .env,
// a restored customer database, or a production connection string.
test('late wholesale approvals preserve original references under concurrent retries', {skip:!process.env.DCL_TEST_PG_BIN},async()=>{
 const bin=process.env.DCL_TEST_PG_BIN,root=fs.mkdtempSync(path.join(os.tmpdir(),'dcl-late-payment-'));
 const port='55483',env={...process.env};
 for(const key of Object.keys(env))if(key.startsWith('PG'))delete env[key];
 const executable=name=>path.join(bin,name+(process.platform==='win32'?'.exe':''));
 function run(name,args,input){
  // Windows server children inherit pipe handles: pg_ctl must use real files,
  // otherwise spawnSync can wait forever after the launcher itself has exited.
  const log=path.join(root,'launcher.log'),fd=name==='pg_ctl'?fs.openSync(log,'w'):null;
  let r;try{r=cp.spawnSync(executable(name),args,{input,env,encoding:'utf8',maxBuffer:8*1024*1024,timeout:60000,...(fd!==null?{stdio:['pipe',fd,fd]}:{})});}finally{if(fd!==null)fs.closeSync(fd);}
  const output=fd!==null?fs.readFileSync(log,'utf8'):(r.stdout||'');
  if(r.status!==0)throw Error(r.stderr||output||String(r.error));return output.trim();
 }
 const args=['-X','-h','127.0.0.1','-p',port,'-U','postgres','-d','postgres','-Atq','-v','ON_ERROR_STOP=1'];
 const sql=s=>run('psql',args,s);
 function asyncSql(s,onOutput=()=>{}){return new Promise((resolve,reject)=>{const child=cp.spawn(executable('psql'),args,{env});let out='',err='';child.stdout.on('data',b=>{out+=b;onOutput(out);});child.stderr.on('data',b=>err+=b);child.on('error',reject);child.on('close',code=>code?reject(Error(err)):resolve(out.trim()));child.stdin.end(s);});}
 const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
 const customer=id(1);
 const settle=(intent,payment)=>`SELECT settle_wholesale_checkout('${id(intent)}','${payment}','pref-${intent}',40,'ARS','approved',(SELECT created_at+interval '1 second' FROM wholesale_checkout_intents WHERE id='${id(intent)}'));`;
 let started=false;
 try{
  run('initdb',['-D',path.join(root,'data'),'-U','postgres','-A','trust','--no-locale','--encoding=UTF8']);
  run('pg_ctl',['-D',path.join(root,'data'),'-l',path.join(root,'postgres.log'),'-o',`-h 127.0.0.1 -p ${port} -F`,'-w','start']);started=true;
  sql(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
  CREATE TABLE customers(id uuid PRIMARY KEY,wholesale_enabled boolean DEFAULT true,wholesale_access_active boolean DEFAULT true,archived_at timestamptz);
  CREATE TABLE wholesale_orders(id uuid PRIMARY KEY,customer_id uuid,status text,confirmed_revision_id uuid);
  CREATE TABLE wholesale_order_revisions(id uuid PRIMARY KEY,order_id uuid,total_amount numeric,currency char(3),UNIQUE(order_id,id));
  CREATE TABLE wholesale_payment_entries(id uuid PRIMARY KEY,order_id uuid,revision_id uuid,entry_type text,refund_of uuid,amount numeric,currency char(3),payment_method text,external_reference text,occurred_at timestamptz,idempotency_key uuid UNIQUE,actor_id uuid);
  CREATE TABLE wholesale_financial_account_mappings(payment_method text,account_id text);
  CREATE TABLE wholesale_financial_postings(payment_entry_id uuid UNIQUE,status text,account_id text);
  CREATE TABLE inventory_sentinel(stock int,reserved int,deliveries int);INSERT INTO inventory_sentinel VALUES(9,2,1);
  CREATE FUNCTION financial_ready_period() RETURNS uuid LANGUAGE sql AS $$ SELECT '${id(2)}'::uuid $$;
  CREATE FUNCTION assert_wholesale_admin_actor(actor uuid) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF actor IS DISTINCT FROM '${customer}'::uuid THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF; END $$;
  CREATE FUNCTION test_post_payment() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN INSERT INTO wholesale_financial_postings VALUES(NEW.id,'posted','mercadopago');RETURN NEW;END $$;
  CREATE TRIGGER test_post AFTER INSERT ON wholesale_payment_entries FOR EACH ROW EXECUTE FUNCTION test_post_payment();
  INSERT INTO customers(id) VALUES('${customer}');INSERT INTO wholesale_financial_account_mappings VALUES('mercadopago','mercadopago');`);
  sql(fs.readFileSync('scripts/maintenance/proposed-wholesale-checkout.sql','utf8'));
  const aclBefore=sql("SELECT proacl::text FROM pg_proc WHERE oid='settle_wholesale_checkout(uuid,text,text,numeric,text,text,timestamptz)'::regprocedure");
  sql(fs.readFileSync('scripts/maintenance/proposed-wholesale-transfer-notices.sql','utf8'));
  assert.equal(sql("SELECT proacl::text FROM pg_proc WHERE oid='settle_wholesale_checkout(uuid,text,text,numeric,text,text,timestamptz)'::regprocedure"),aclBefore);
  for(let n=10;n<=16;n++)sql(`INSERT INTO wholesale_orders VALUES('${id(n)}','${customer}','confirmed','${id(n+100)}');INSERT INTO wholesale_order_revisions VALUES('${id(n+100)}','${id(n)}',100,'ARS');`);
  function intent(n,order,closed=false){sql(`SELECT begin_wholesale_checkout('${customer}','${id(order)}',40,'${id(n)}');UPDATE wholesale_checkout_intents SET preference_id='pref-${n}',created_at=clock_timestamp()-interval '2 minutes',expires_at=clock_timestamp()+interval '10 minutes' WHERE id='${id(n)}';`);if(closed)sql(`UPDATE wholesale_checkout_intents SET expires_at=clock_timestamp()-interval '1 minute' WHERE id='${id(n)}';SELECT close_verified_wholesale_checkout('${customer}','${id(order)}','${id(n)}','pref-${n}',true);`);}
  intent(20,10,true);intent(21,10);intent(22,11);
  // Hold the exact order lock to prove real cross-session serialization.
  let locked;
  const lockReady=new Promise(resolve=>{locked=resolve;});
  const holder=asyncSql(`BEGIN;SELECT id FROM wholesale_orders WHERE id='${id(10)}' FOR UPDATE;
\\echo LOCKED
SELECT pg_sleep(0.5);COMMIT;`,out=>{if(out.includes('LOCKED'))locked();});
  await Promise.race([lockReady,holder.then(()=>{throw Error('Lock holder exited before synchronization');})]);
  const outcomes=await Promise.all([asyncSql(settle(20,'1001')),asyncSql(settle(20,'1001')),asyncSql(settle(22,'1002'))]);await holder;
  assert.deepEqual(outcomes,['review','review','approved']);
  assert.equal(sql(`SELECT intent_id FROM wholesale_checkout_receipts WHERE payment_id='1001'`),id(20));
  assert.equal(sql(`SELECT state FROM wholesale_checkout_intents WHERE id='${id(20)}'`),'closed');
  assert.equal(sql(`SELECT count(*) FROM wholesale_payment_entries WHERE order_id='${id(10)}'`),'0');
  assert.equal(sql(`SELECT count(*) FROM wholesale_payment_entries WHERE order_id='${id(11)}' AND id='${id(22)}'`),'1');
  assert.equal(sql(settle(21,'1003')),'review'); // prior review persists, no guard rollback
  assert.equal(sql(settle(22,'1002')),'approved'); // already posted, duplicate notification
  assert.equal(sql(settle(22,'1004')),'review'); // second provider ID cannot double post
  intent(23,12);sql(`UPDATE wholesale_orders SET status='cancelled' WHERE id='${id(12)}'`);
  assert.deepEqual(await Promise.all([asyncSql(settle(23,'1005')),asyncSql(settle(23,'1005'))]),['review','review']);
  intent(24,13,true);assert.equal(sql(settle(24,'1006')),'review');
  intent(25,14);
  assert.deepEqual(await Promise.all([asyncSql(settle(25,'1007')),asyncSql(settle(25,'1007'))]),['approved','approved']);
  // Same key/double click reuses an intent; different key cannot open a second.
  intent(26,15);
  const retry=`SELECT (begin_wholesale_checkout('${customer}','${id(15)}',40,'${id(26)}')->>'id');`;
  assert.deepEqual(await Promise.all([asyncSql(retry),asyncSql(retry)]),[id(26),id(26)]);
  assert.throws(()=>sql(`SELECT begin_wholesale_checkout('${customer}','${id(15)}',40,'${id(27)}')`),/IN_PROGRESS/);
  intent(28,16,true);intent(29,16);
  const racing=await Promise.all([asyncSql(settle(28,'1008')),asyncSql(settle(29,'1009'))]);
  assert.equal(racing[0],'review');assert.ok(['review','approved'].includes(racing[1]));
  const posted=String(2+(racing[1]==='approved'?1:0));
  assert.equal(sql('SELECT count(*) FROM wholesale_payment_entries'),posted);
  assert.equal(sql('SELECT count(*) FROM wholesale_financial_postings'),posted);
  assert.equal(sql('SELECT stock||\',\'||reserved||\',\'||deliveries FROM inventory_sentinel'),'9,2,1');
  assert.equal(sql("SELECT count(*) FROM wholesale_checkout_events WHERE intent_id='"+id(20)+"' AND event='review'"),'1');
  // Transfer notices use the same order row lock as checkout and settlement.
  for(let n=30;n<=34;n++)sql(`INSERT INTO wholesale_orders VALUES('${id(n)}','${customer}','confirmed','${id(n+100)}');INSERT INTO wholesale_order_revisions VALUES('${id(n+100)}','${id(n)}',100,'ARS');`);
  const notice=(order,key,amount=40)=>`SELECT record_wholesale_transfer_notice('${customer}','${id(order)}',${amount},'${id(key)}','inform',NULL)->>'id';`;
  const moneyBefore=sql('SELECT (SELECT count(*) FROM wholesale_payment_entries)||\',\'||(SELECT count(*) FROM wholesale_financial_postings)');
  assert.deepEqual(await Promise.all([asyncSql(notice(30,40)),asyncSql(notice(30,40))]),[id(40),id(40)]);
  assert.deepEqual(await Promise.all([asyncSql(notice(30,41)),asyncSql(notice(30,42))]),[id(40),id(40)]);
  assert.throws(()=>sql(notice(30,43,41)),/NOTICE_ALREADY_PENDING/);
  assert.equal(sql(`SELECT count(*) FROM wholesale_transfer_notice_events WHERE notice_id='${id(40)}'`),'1');
  assert.equal(sql('SELECT (SELECT count(*) FROM wholesale_payment_entries)||\',\'||(SELECT count(*) FROM wholesale_financial_postings)'),moneyBefore);
  const resolve=(order,key,status,payment='NULL',actor=customer)=>`SELECT resolve_wholesale_transfer_notice('${id(order)}','${id(key)}','${status}',${payment},'${actor}');`;
  assert.throws(()=>sql(resolve(30,40,'verified',`'${id(99)}'`)),/NOTICE_PAYMENT_PROOF/);
  assert.throws(()=>sql(resolve(30,40,'not_received','NULL',id(99))),/ADMIN_REQUIRED/);
  // Admin links an already posted receipt, never creates another financial entry.
  sql(`INSERT INTO wholesale_payment_entries(id,order_id,revision_id,entry_type,amount,currency,payment_method) VALUES('${id(50)}','${id(30)}','${id(130)}','payment',40,'ARS','bank_transfer');`);
  const moneyWithProof=sql('SELECT (SELECT count(*) FROM wholesale_payment_entries)||\',\'||(SELECT count(*) FROM wholesale_financial_postings)');
  await Promise.all([asyncSql(resolve(30,40,'verified',`'${id(50)}'`)),asyncSql(resolve(30,40,'verified',`'${id(50)}'`))]);
  assert.equal(sql(`SELECT count(*) FROM wholesale_transfer_notice_events WHERE notice_id='${id(40)}' AND event='verified'`),'1');
  assert.equal(sql('SELECT (SELECT count(*) FROM wholesale_payment_entries)||\',\'||(SELECT count(*) FROM wholesale_financial_postings)'),moneyWithProof);
  assert.equal(sql(notice(30,40)),id(40)); // lost response retry remains resolved
  sql(notice(31,44));
  await Promise.all([asyncSql(resolve(31,44,'not_received')),asyncSql(resolve(31,44,'not_received'))]);
  assert.equal(sql(`SELECT count(*) FROM wholesale_transfer_notice_events WHERE notice_id='${id(44)}' AND event='not_received'`),'1');
  sql(notice(32,45));
  const withdraw=`SELECT record_wholesale_transfer_notice('${customer}','${id(32)}',NULL,'${id(45)}','withdraw','${id(45)}');`;
  const conflict=await Promise.allSettled([asyncSql(withdraw),asyncSql(resolve(32,45,'not_received'))]);
  assert.equal(conflict.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(sql(`SELECT count(*) FROM wholesale_transfer_notice_events WHERE notice_id='${id(45)}'`),'2');
  const reserveRace=await Promise.allSettled([asyncSql(notice(33,46,70)),asyncSql(`SELECT begin_wholesale_checkout('${customer}','${id(33)}',60,'${id(51)}');`)]);
  assert.equal(reserveRace.filter(r=>r.status==='fulfilled').length,1);
  assert.match(reserveRace.find(r=>r.status==='rejected').reason.message,/NOTICE_AMOUNT_RESERVED/);
  assert.equal(sql('SELECT (SELECT count(*) FROM wholesale_payment_entries)||\',\'||(SELECT count(*) FROM wholesale_financial_postings)'),moneyWithProof);
  assert.equal(sql('SELECT stock||\',\'||reserved||\',\'||deliveries FROM inventory_sentinel'),'9,2,1');
 }finally{
  if(started)run('pg_ctl',['-D',path.join(root,'data'),'-m','immediate','-w','stop']);
  // Only the fresh mkdtemp directory created above is removed.
  fs.rmSync(root,{recursive:true,force:true});
 }
});
