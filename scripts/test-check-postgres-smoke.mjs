// Explicit optional simulation: real isolated PostgreSQL, synthetic data only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { runTestCheck, checkTestCheck, planTestCheck, updateTestCheckApproval } from '../dist/lib/test-check.js';
const hash = b => 'sha256:' + createHash('sha256').update(b).digest('hex');
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'yam-pg-gate-')));
const owner = randomUUID();
const container = 'yam-test-gate-' + owner.slice(0,12);
const image = process.env.YAM_TEST_PG_IMAGE || 'postgres:17-alpine';
const rows=[];
let started=false, cleanup=false, failure, engineVersion='', imageIdentity='';
const docker = (args,input) => spawnSync('docker',args,{input,encoding:'utf8',timeout:60000,maxBuffer:8*1024*1024});
const query = (sql,db='postgres') => docker(['exec','-i',container,'psql','-U','postgres','-d',db,'-qAXt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],sql);
const sql = (text,db='postgres') => {const r=query(text,db); assert.equal(r.status,0,'fixture SQL execution failed');return r.stdout.trim();};
const write = (f,v) => {fs.mkdirSync(path.dirname(path.join(root,f)),{recursive:true});fs.writeFileSync(path.join(root,f),typeof v==='string'?v:JSON.stringify(v));};
const git=(...a)=>{const r=spawnSync('git',a,{cwd:root,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
const record=(name,fn)=>{fn();rows.push({name,result:'passed'});};
const broken=`CREATE OR REPLACE FUNCTION public.save_receiving(p_brand integer,p_key text,p_qty integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE b public.brands%ROWTYPE; v_brand integer; v_id integer;
BEGIN
 SELECT b.id INTO v_brand FROM public.brands b WHERE b.id=p_brand;
 INSERT INTO receiving_orders(brand_id,request_key) VALUES(v_brand,p_key) RETURNING id INTO v_id;
 INSERT INTO receiving_items(order_id,quantity) VALUES(v_id,p_qty);
 RETURN v_id;
END; $$;
REVOKE ALL ON FUNCTION public.save_receiving(integer,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_receiving(integer,text,integer) TO gate_allowed;
`;
const schema=`CREATE TABLE public.brands(id integer PRIMARY KEY);
INSERT INTO public.brands VALUES(1);
CREATE TABLE public.receiving_orders(id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,brand_id integer REFERENCES public.brands(id),request_key text UNIQUE NOT NULL);
CREATE TABLE public.receiving_items(order_id integer REFERENCES public.receiving_orders(id),quantity integer NOT NULL CHECK(quantity>0));
CREATE TABLE public.gate_migrations(file text PRIMARY KEY,sha256 text NOT NULL);
CREATE TABLE public.gate_identity(id integer PRIMARY KEY,source_digest text NOT NULL);
`+broken;
const fixed=`CREATE OR REPLACE FUNCTION public.save_receiving(p_brand integer,p_key text,p_qty integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_brand integer; v_id integer;
BEGIN
 SELECT br.id INTO v_brand FROM public.brands br WHERE br.id=p_brand;
 IF NOT FOUND THEN RAISE EXCEPTION 'unknown brand' USING ERRCODE='22023'; END IF;
 SELECT ro.id INTO v_id FROM receiving_orders ro WHERE ro.request_key=p_key;
 IF FOUND THEN RETURN v_id; END IF;
 INSERT INTO receiving_orders(brand_id,request_key) VALUES(v_brand,p_key) RETURNING id INTO v_id;
 INSERT INTO receiving_items(order_id,quantity) VALUES(v_id,p_qty);
 RETURN v_id;
END; $$;
REVOKE ALL ON FUNCTION public.save_receiving(integer,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_receiving(integer,text,integer) TO gate_allowed;
`;
function apply(file,db='postgres') {
 const bytes=fs.readFileSync(path.join(root,file));sql(bytes.toString(),db);
 sql(`INSERT INTO gate_migrations VALUES('${file}','${hash(bytes)}') ON CONFLICT(file) DO UPDATE SET sha256=EXCLUDED.sha256;`,db);
}
const adapter = `import fs from 'node:fs';import{spawnSync}from'node:child_process';import{createHash}from'node:crypto';
const container=process.env.YAM_PG_CONTAINER;
const q=(text,db='postgres')=>spawnSync('docker',['exec','-i',container,'psql','-U','postgres','-d',db,'-qAXt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],{input:text,encoding:'utf8',timeout:30000});
const sql=(text,db)=>{const r=q(text,db);if(r.status!==0)throw Error('fixture SQL failed');return r.stdout.trim();};
const hash=b=>'sha256:'+createHash('sha256').update(b).digest('hex');
const policy=JSON.parse(fs.readFileSync('testing/policy.json'));
const key='simulation-'+Date.now();const results={};
const run=(name,fn)=>{try{results[name]=fn()===true;}catch{results[name]=false;}};
run('success',()=>Number(sql("SET ROLE gate_allowed; SELECT save_receiving(1,'"+key+"',2);"))>0);
run('denied',()=>{const r=q("SET ROLE gate_denied; SELECT save_receiving(1,'denied',2);");return r.status!==0&&r.stderr.includes('42501')&&sql("SELECT count(*) FROM receiving_orders WHERE request_key='denied';")==='0';});
run('invalid',()=>{const r=q("SET ROLE gate_allowed; SELECT save_receiving(999,'invalid',2);");return r.status!==0&&r.stderr.includes('22023')&&sql("SELECT count(*) FROM receiving_orders WHERE request_key='invalid';")==='0';});
run('readback',()=>sql("SELECT count(*) FROM receiving_orders ro JOIN receiving_items ri ON ri.order_id=ro.id WHERE ro.request_key='"+key+"' AND ro.brand_id=1 AND ri.quantity=2;")==='1');
run('rollback',()=>{const r=q("SET ROLE gate_allowed; SELECT save_receiving(1,'rollback',-1);");return r.status!==0&&r.stderr.includes('23514')&&sql("SELECT count(*) FROM receiving_orders WHERE request_key='rollback';")==='0';});
run('retry',()=>{sql("SET ROLE gate_allowed; SELECT save_receiving(1,'"+key+"',2);");return sql("SELECT count(*) FROM receiving_orders WHERE request_key='"+key+"';")==='1';});
run('revoked',()=>{sql('REVOKE EXECUTE ON FUNCTION public.save_receiving(integer,text,integer) FROM gate_allowed;');try{const r=q("SET ROLE gate_allowed; SELECT save_receiving(1,'revoked',2);");return r.status!==0&&r.stderr.includes('42501');}finally{sql('GRANT EXECUTE ON FUNCTION public.save_receiving(integer,text,integer) TO gate_allowed;');}});
run('matrix',()=>{let ok=true;for(const role of ['gate_allowed','gate_denied'])for(const brand of [1,999])for(const qty of [-1,0,1,2]){const k=key+'-'+role+'-'+brand+'-'+qty;const r=q('SET ROLE '+role+"; SELECT save_receiving("+brand+",'"+k+"',"+qty+");");const failure=role==='gate_denied'?'42501':brand===999?'22023':qty<=0?'23514':null;if(failure)ok=(r.status!==0&&r.stderr.includes(failure)&&sql("SELECT count(*) FROM receiving_orders WHERE request_key='"+k+"';")==='0')&&ok;else ok=(r.status===0&&sql("SELECT count(*) FROM receiving_orders ro JOIN receiving_items ri ON ro.id=ri.order_id WHERE ro.request_key='"+k+"' AND ri.quantity="+qty+";")==='1')&&ok;}return ok;});
run('migration_upgrade',()=>sql("SELECT count(*) FROM gate_migrations WHERE file='migrations/002.sql';")==='1'&&Number(sql("SET ROLE gate_allowed; SELECT save_receiving(1,'upgrade-"+key+"',2);"))>0);
run('migration_fresh',()=>{const db='fresh_'+Date.now();sql('CREATE DATABASE '+db+';');try{for(const file of ['migrations/001.sql','migrations/002.sql']){sql(fs.readFileSync(file,'utf8'),db);}return Number(sql("SET ROLE gate_allowed; SELECT save_receiving(1,'fresh',2);",db))>0;}finally{sql('DROP DATABASE '+db+';');}});
const cfg=JSON.parse(spawnSync('docker',['inspect','--format','{{json .HostConfig}}',container],{encoding:'utf8'}).stdout);
const isolated=cfg.NetworkMode==='none' && !(cfg.Binds?.length) && !Object.keys(cfg.PortBindings||{}).length;
const environment={schema:'yam.test-environment.v1',safety:{kind:isolated?'disposable':'unsafe',production:!isolated,external_effects:!isolated},engine:'postgresql',engine_version:sql('SHOW server_version;'),source_digest:sql('SELECT source_digest FROM gate_identity WHERE id=1;'),configuration_digest:hash(sql("DO $$ BEGIN NULL; END $$; SHOW plpgsql.variable_conflict;")+sql("SELECT pg_get_functiondef('public.save_receiving(integer,text,integer)'::regprocedure);")),roles_digest:hash(sql("SELECT has_function_privilege('gate_allowed','public.save_receiving(integer,text,integer)','EXECUTE')::text||','||has_function_privilege('gate_denied','public.save_receiving(integer,text,integer)','EXECUTE')::text;")),fixtures_digest:hash(sql('SELECT id FROM brands ORDER BY id;')),migrations:JSON.parse(sql("SELECT coalesce(json_agg(row_to_json(m)), '[]'::json) FROM (SELECT file,sha256 FROM gate_migrations ORDER BY file)m;"))};
console.log(JSON.stringify({schema:'yam.test-observation.v1',tests:policy.surfaces[0].checks.map(c=>({id:c.id,target:c.target,scenario:c.scenario,evidence:'integration',status:results[c.scenario]?'passed':'failed',tests:1,assertions:1,failed:results[c.scenario]?0:1,skipped:0,mocked:process.env.YAM_PG_MOCK==='1',environment}))}));
`;
try {
 const launch=docker(['run','-d','--pull','never','--name',container,'--label','yam.test-check='+owner,'--network','none','--memory','384m','--cpus','1','--pids-limit','128','--tmpfs','/var/lib/postgresql/data:rw,size=256m','-e','POSTGRES_HOST_AUTH_METHOD=trust',image]);
 assert.equal(launch.status,0,'isolated local PostgreSQL image/runtime unavailable');started=true;
 let ready=false;
 for(let i=0;i<120;i++){const process=docker(['exec',container,'cat','/proc/1/comm']);if(process.status===0 && process.stdout.trim()==='postgres' && query('SELECT 1;').status===0){ready=true;break;}await new Promise(r=>setTimeout(r,250));}
 assert(ready,'isolated PostgreSQL did not become ready');
 engineVersion=sql('SHOW server_version;');imageIdentity=docker(['inspect','--format','{{.Image}}',container]).stdout.trim();assert(/^sha256:[a-f0-9]{64}$/.test(imageIdentity));
 sql('CREATE ROLE gate_allowed NOLOGIN; CREATE ROLE gate_denied NOLOGIN;');
 write('.gitignore','.yam/\n');write('migrations/001.sql',schema);write('adapter.mjs',adapter);
 const scenarios=['success','denied','invalid','readback','rollback','migration_upgrade','migration_fresh','retry','revoked','matrix'];
 const policy={schema:'yam.test-policy.v1',execution:{approval:'required',trigger:'changed_surface',commit:'security_only',push:'security_only',deploy:'test_required'},surfaces:[{id:'receiving',paths:['migrations/**','testing/**'],risks:['db'],targets:['function:public.save_receiving'],checks:scenarios.map(s=>({id:'pg-'+s,target:'function:public.save_receiving',scenario:s,explanation:'Real PostgreSQL '+s,evidence:'integration',command:['$NODE','adapter.mjs'],environment:'.yam/environment.json'}))}]};
 write('testing/policy.json',policy);git('init');git('config','user.email','fixture@example.invalid');git('config','user.name','PostgreSQL simulation');git('add','.');git('commit','-m','broken baseline');const base=git('rev-parse','HEAD');
 write('migrations/002.sql',fixed);const source=planTestCheck(root,policy,base).source_digest;
 apply('migrations/001.sql');sql(`INSERT INTO gate_identity VALUES(1,'${source}');`);
 record('DDL succeeds but ambiguous function fails with 42702',()=>{const r=query("SET ROLE gate_allowed; SELECT save_receiving(1,'old',2);");assert.notEqual(r.status,0);assert(r.stderr.includes('42702'));});
 sql('CREATE DATABASE candidate_reference;');
 apply('migrations/001.sql','candidate_reference');apply('migrations/002.sql','candidate_reference');sql(`INSERT INTO gate_identity VALUES(1,'${source}');`,'candidate_reference');
 const expected={schema:'yam.test-environment.v1',safety:{kind:'disposable',production:false,external_effects:false},engine:'postgresql',engine_version:sql('SHOW server_version;'),source_digest:source,configuration_digest:hash(sql('DO $$ BEGIN NULL; END $$; SHOW plpgsql.variable_conflict;','candidate_reference')+sql("SELECT pg_get_functiondef('public.save_receiving(integer,text,integer)'::regprocedure);",'candidate_reference')),roles_digest:hash(sql("SELECT has_function_privilege('gate_allowed','public.save_receiving(integer,text,integer)','EXECUTE')::text||','||has_function_privilege('gate_denied','public.save_receiving(integer,text,integer)','EXECUTE')::text;",'candidate_reference')),fixtures_digest:hash(sql('SELECT id FROM brands ORDER BY id;','candidate_reference')),migrations:['migrations/001.sql','migrations/002.sql'].map(file=>({file,sha256:hash(fs.readFileSync(path.join(root,file)))}))};
 write('.yam/environment.json',expected);sql('DROP DATABASE candidate_reference;');process.env.YAM_PG_CONTAINER=container;
 const runApproved=()=>{
   const request=updateTestCheckApproval(root,'request',{base});if(!request.ok)return request;
   const approval=updateTestCheckApproval(root,'approve',{base});if(!approval.ok)return approval;
   return runTestCheck(root,{base});
 };
 record('old applied migration/runtime is BLOCKED',()=>{const r=runApproved();assert.equal(r.result,'BLOCKED');const receipt=JSON.parse(fs.readFileSync(path.join(root,r.receipt)));assert(receipt.measurements.some(m=>m.errors.some(e=>e.startsWith('environment_mismatch'))));});
 apply('migrations/002.sql');
 record('fixed real DB succeeds across ten scenarios plus 16 matrix combinations',()=>{const r=runApproved();assert.equal(r.result,'PASS',JSON.stringify(r));assert.equal(checkTestCheck(root).result,'PASS');});
 record('removed normal-save scenario is BLOCKED',()=>{const p=structuredClone(policy);p.surfaces[0].checks=p.surfaces[0].checks.filter(c=>c.scenario!=='success');write('testing/policy.json',p);const r=runApproved();assert.equal(r.result,'BLOCKED');assert(r.errors.includes('missing_scenario:success'));write('testing/policy.json',policy);});
 record('mock-labelled report cannot replace real DB evidence',()=>{try{process.env.YAM_PG_MOCK='1';const r=runApproved();assert.equal(r.result,'BLOCKED');assert(r.errors.some(e=>e.startsWith('mock_substitution')));}finally{delete process.env.YAM_PG_MOCK;}});
 record('function drift despite matching migration ledger is BLOCKED',()=>{sql(broken);const r=runApproved();assert.equal(r.result,'BLOCKED');assert(r.errors.some(e=>e.startsWith('environment_mismatch')));sql(fixed);});
 record('restored candidate revalidates PASS',()=>{assert.equal(runApproved().result,'PASS');assert.equal(checkTestCheck(root).result,'PASS');});
} catch(e) {failure=e;}
finally {
 delete process.env.YAM_PG_CONTAINER;delete process.env.YAM_PG_MOCK;
 const owned=docker(['inspect','--format','{{index .Config.Labels "yam.test-check"}}',container]);
 if(owned.status===0 && owned.stdout.trim()===owner){const r=docker(['rm','-f',container]);cleanup=r.status===0&&docker(['inspect',container]).status!==0;}
 else if(!started && owned.status!==0)cleanup=true;
 fs.rmSync(root,{recursive:true,force:true});
 const receipt={schema:'yam.postgres-simulation.v1',result:failure||!cleanup?'BLOCKED':'PASS',engine:'PostgreSQL local image',engine_version:engineVersion,image_identity:imageIdentity,network:'none',workflow_scenarios:10,matrix_combinations:16,cases:rows,container_removed:cleanup,fixture_directory_removed:!fs.existsSync(root),production_access:false};
 if(process.env.YAM_PG_RECEIPT)fs.writeFileSync(process.env.YAM_PG_RECEIPT,JSON.stringify(receipt,null,2)+'\n');
 console.log(JSON.stringify(receipt));
}
if(failure)throw failure;
assert(cleanup,'container cleanup not verified');
