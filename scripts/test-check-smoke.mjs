import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { runTestCheck, checkTestCheck, testCheckStop, runTestCheckCommand } from '../dist/lib/test-check.js';
const hash = x => 'sha256:' + createHash('sha256').update(x).digest('hex');
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'yam-test-check-')));
const git = (...args) => { const r=spawnSync('git',args,{cwd:root,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim(); };
const write = (f,s) => {fs.mkdirSync(path.dirname(path.join(root,f)),{recursive:true});fs.writeFileSync(path.join(root,f), typeof s==='string'?s:JSON.stringify(s));};
const read = f=>JSON.parse(fs.readFileSync(path.join(root,f),'utf8'));
const policyFile='testing/policy.json';
const cases=['success','invalid','boundary'];
const checks=cases.map(s=>({id:s,target:'feature',scenario:s,explanation:'Exercise '+s,evidence:'unit',command:['$NODE','adapter.cjs']}));
const policy=()=>({schema:'yam.test-policy.v1',surfaces:[{id:'feature',paths:['feature.ts','binary.dat','adapter.cjs','testing/**'],risks:['logic'],targets:['feature'],checks:structuredClone(checks)}]});
let count=0;const results=[];
const test=(name,fn)=>{fn(); count++;results.push({name,result:'passed'});};
try {
 git('init');git('config','user.email','fixture@example.invalid');git('config','user.name','Test fixture');
 write('feature.ts','old');
 write('adapter.cjs',`const fs=require('node:fs'); const p=JSON.parse(fs.readFileSync('testing/policy.json')); let tests=p.surfaces.flatMap(s=>s.checks).map(c=>({id:c.id,target:c.target,scenario:c.scenario,evidence:c.evidence,status:'passed',tests:1,assertions:1,failed:0,skipped:0,mocked:false,environment:c.environment?JSON.parse(fs.readFileSync(c.environment)):null}));
fs.mkdirSync('.yam',{recursive:true});fs.writeFileSync('.yam/adapter-started','1');
const mode=process.env.YAM_FIXTURE_MODE;
if(mode==='zero')tests.forEach(t=>t.tests=0);
if(mode==='assertions')tests.forEach(t=>t.assertions=0);
if(mode==='failed')tests[0].failed=1;
if(mode==='skipped')tests[0].skipped=1;
if(mode==='mock')tests.forEach(t=>t.mocked=true);
if(mode==='duplicate')tests.push(tests[0]);
if(mode==='stale-env')tests.forEach(t=>t.environment={wrong:true});
if(mode==='mutate')fs.appendFileSync('feature.ts','late');
if(mode==='leak'){console.error('fixture-private-value');tests.forEach(t=>t.extra='fixture-private-value');}
console.log(JSON.stringify({schema:'yam.test-observation.v1',tests})); if(mode==='exit')process.exit(2);`);
 write(policyFile,policy());git('add','.');git('commit','-m','fixture baseline');const base=git('rev-parse','HEAD');
 write('feature.ts','new');
 const run=()=>runTestCheck(root,{base});
 const blocked=(mode)=>{process.env.YAM_FIXTURE_MODE=mode;assert.equal(run().result,'BLOCKED');delete process.env.YAM_FIXTURE_MODE;};
 test('actual success',()=>{assert.equal(run().result,'PASS');assert.equal(checkTestCheck(root).result,'PASS');});
 test('staged versus unstaged',()=>{assert.equal(checkTestCheck(root,{stage:'commit'}).result,'BLOCKED');git('add','feature.ts');assert.equal(checkTestCheck(root,{stage:'commit'}).result,'PASS');});
 for(const mode of ['zero','assertions','failed','skipped','duplicate','exit'])test(mode,()=>blocked(mode));
 test('missing happy path',()=>{const p=policy();p.surfaces[0].checks=p.surfaces[0].checks.filter(c=>c.scenario!=='success');write(policyFile,p);assert.equal(run().result,'BLOCKED');write(policyFile,policy());});
 test('unmapped file',()=>{write('unmapped.ts','new');assert.equal(run().result,'BLOCKED');fs.unlinkSync(path.join(root,'unmapped.ts'));});
 test('risk downgrade',()=>{write('migrations/001.sql','CREATE FUNCTION public.receiving() RETURNS void AS $$ BEGIN END $$ LANGUAGE plpgsql;');const p=policy();p.surfaces[0].paths.push('migrations/**');write(policyFile,p);assert.equal(run().result,'BLOCKED');fs.rmSync(path.join(root,'migrations'),{recursive:true});write(policyFile,policy());});
 test('mid-run mutation',()=>{blocked('mutate');write('feature.ts','new');});
 test('stale result after edit',()=>{assert.equal(run().result,'PASS');write('feature.ts','newer');assert.equal(checkTestCheck(root).result,'BLOCKED');write('feature.ts','new');});
 test('forged PASS',()=>{blocked('exit');const p='.yam/testing/latest.json',r=read(p);r.result='PASS';write(p,r);assert.equal(checkTestCheck(root).result,'BLOCKED');});
 test('policy changed',()=>{assert.equal(run().result,'PASS');const p=policy();p.surfaces[0].checks.pop();write(policyFile,p);assert.equal(checkTestCheck(root).result,'BLOCKED');write(policyFile,policy());});
 test('note deleted',()=>{assert.equal(run().result,'PASS');fs.unlinkSync(path.join(root,'.yam/testing/notes.md'));assert.equal(checkTestCheck(root).result,'BLOCKED');});
 test('safe subprocess output',()=>{process.env.YAM_FIXTURE_MODE='leak';assert.equal(run().result,'PASS');delete process.env.YAM_FIXTURE_MODE;assert(!fs.readFileSync(path.join(root,'.yam/testing/latest.json'),'utf8').includes('fixture-private-value'));});
 test('stop gate blocks even correction turn',()=>{write('feature.ts','different');assert.equal(testCheckStop(root,true,'Done').decision,'block');assert.equal(testCheckStop(root,true,'Test check: BLOCKED; unable to verify').continue,true);assert.equal(testCheckStop(root,false,'Read only'),null);write('feature.ts','new');});
 test('invalid metadata is never persisted verbatim',()=>{
   const marker='token=fixture_supersecret_123';const r=runTestCheck(root,{base,stage:marker});assert.equal(r.result,'BLOCKED');
   for(const f of ['.yam/testing/notes.md','.yam/testing/latest.json']) assert(!fs.readFileSync(path.join(root,f),'utf8').includes(marker),'unsafe metadata leaked into '+f);
 });
 test('invalid baseline is never persisted verbatim',()=>{
   const marker='token=fixture_baseline_secret_123';assert.equal(runTestCheck(root,{base:marker}).result,'BLOCKED');
   for(const f of ['.yam/testing/notes.md','.yam/testing/latest.json'])assert(!fs.readFileSync(path.join(root,f),'utf8').includes(marker));
 });
 test('oversized policy cannot launch unbounded test commands',()=>{
   const p=policy();p.surfaces[0].checks=Array.from({length:257},(_,i)=>({...checks[0],id:'bounded-'+i}));write(policyFile,p);
   const result=run();assert.equal(result.result,'BLOCKED');assert(result.errors.includes('policy_limit'));write(policyFile,policy());
 });
 test('invalid run options leave a failed note',()=>{
   const file=path.join(root,'.yam/testing/notes.md'),before=fs.readFileSync(file,'utf8').length;
   assert.equal(runTestCheckCommand(['run','--unknown','fixture'],root).result,'BLOCKED');assert(fs.readFileSync(file,'utf8').length>before);
 });
 test('uppercase SQL cannot downgrade DB checks',()=>{
   write('receiving.SQL','CREATE FUNCTION public.receiving() RETURNS void AS $$ BEGIN END $$ LANGUAGE plpgsql;');
   const p=policy();p.surfaces[0].paths.push('receiving.SQL');write(policyFile,p);
   const result=run();assert.equal(result.result,'BLOCKED');assert(result.errors.includes('missing_risk:db'));
   fs.unlinkSync(path.join(root,'receiving.SQL'));write(policyFile,policy());
 });
 test('quoted handoff marker cannot bypass Stop',()=>{write('feature.ts','different');assert.equal(testCheckStop(root,true,'Example: "Test check: BLOCKED". Done.').decision,'block');write('feature.ts','new');});
 test('configured Stop cannot fail open when Git disappears',()=>{
   const old=process.env.PATH;try{process.env.PATH=path.join(root,'absent-bin');assert.equal(testCheckStop(root,true,'Done').decision,'block');}finally{process.env.PATH=old;}
 });
 test('CI missing trust pin never executes project commands',()=>{
   const marker=path.join(root,'.yam/adapter-started');fs.rmSync(marker,{force:true});
   const r=runTestCheck(root,{base,stage:'ci',source:git('rev-parse','HEAD')});assert.equal(r.result,'BLOCKED');assert(r.errors.includes('trusted_policy_pin_required'));assert(!fs.existsSync(marker));
 });
 test('wrong and required policy pins',()=>{assert.equal(runTestCheck(root,{base,pin:'sha256:'+'0'.repeat(64)}).result,'BLOCKED');});
 test('binary identity',()=>{fs.writeFileSync(path.join(root,'binary.dat'),Buffer.from([0,255,128,13,10]));assert.equal(run().result,'PASS');git('add','binary.dat','feature.ts',policyFile);assert.equal(checkTestCheck(root,{stage:'commit'}).result,'PASS');});
 test('postcommit reuse and exact source',()=>{git('commit','-m','changed');const source=git('rev-parse','HEAD');assert.equal(checkTestCheck(root,{stage:'push',source}).result,'PASS');assert.equal(checkTestCheck(root,{stage:'push',source:base}).result,'BLOCKED');assert.equal(checkTestCheck(root,{stage:'ci',source}).result,'BLOCKED');assert.equal(checkTestCheck(root,{stage:'ci',source,pin:hash(fs.readFileSync(path.join(root,policyFile)))}).result,'PASS');});
 test('expected baseline cannot be silently narrowed',()=>{
   assert.equal(checkTestCheck(root,{base}).result,'PASS');
   assert(checkTestCheck(root,{base:git('rev-parse','HEAD')}).errors.includes('baseline_mismatch'));
 });
 test('empty changes cannot approve work',()=>assert.equal(runTestCheck(root,{base:git('rev-parse','HEAD')}).result,'BLOCKED'));
 const deploySource=git('rev-parse','HEAD'), testPin=hash(fs.readFileSync(path.join(root,policyFile)));
 write('.yam/artifact.tgz','fixture artifact');write('.yam/config.json','{}');
 const deployOptions={base,stage:'deploy',source:deploySource,pin:testPin,artifact:'.yam/artifact.tgz',configuration:'.yam/config.json'};
 test('deploy exact files',()=>{assert.equal(runTestCheck(root,deployOptions).result,'PASS');assert.equal(checkTestCheck(root,deployOptions).result,'PASS');});
 test('changed deployment artifact',()=>{write('.yam/artifact.tgz','changed artifact');assert.equal(checkTestCheck(root,deployOptions).result,'BLOCKED');write('.yam/artifact.tgz','fixture artifact');});
 test('changed deployment config',()=>{write('.yam/config.json','changed configuration');assert.equal(checkTestCheck(root,deployOptions).result,'BLOCKED');write('.yam/config.json','{}');});
 test('deployment cannot reuse completion-only receipt',()=>{assert.equal(run().result,'PASS');assert.equal(checkTestCheck(root,deployOptions).result,'BLOCKED');});
 // Actual integration protocol + migration manifest checks; adapter simulates DB observation, not a real DB.
 const dbCases=['success','denied','invalid','readback','rollback','migration_upgrade','migration_fresh'];
 write('migrations/001.sql','CREATE FUNCTION public.receiving() RETURNS void AS $$ BEGIN END $$ LANGUAGE plpgsql;');
 let dbPolicy=policy();dbPolicy.surfaces.push({id:'db',paths:['migrations/**'],risks:['db'],targets:['function:public.receiving'],checks:dbCases.map(s=>({id:'db-'+s,target:'function:public.receiving',scenario:s,explanation:'DB fixture '+s,evidence:'integration',command:['$NODE','adapter.cjs'],environment:'.yam/environment.json'}))});
 write(policyFile,dbPolicy);
 // Obtain the exact digest using the public planner (no passing report produced).
 const {planTestCheck}=await import('../dist/lib/test-check.js');
 const env={schema:'yam.test-environment.v1',engine:'fixture-postgres',engine_version:'fixture',source_digest:planTestCheck(root,dbPolicy,base).source_digest,configuration_digest:hash('config'),roles_digest:hash('roles'),fixtures_digest:hash('synthetic'),migrations:[{file:'migrations/001.sql',sha256:hash(fs.readFileSync(path.join(root,'migrations/001.sql')))}]};
 write('.yam/environment.json',env);
 test('DB protocol fixture',()=>assert.equal(run().result,'PASS'));
 test('mock substitution',()=>blocked('mock'));
 test('old applied environment',()=>blocked('stale-env'));
 test('missing migration',()=>{write('.yam/environment.json',{...env,migrations:[]});assert.equal(run().result,'BLOCKED');write('.yam/environment.json',env);});
 test('missing changed SQL object',()=>{const p=structuredClone(dbPolicy);p.surfaces[1].targets=['db'];p.surfaces[1].checks.forEach(c=>c.target='db');write(policyFile,p);assert.equal(run().result,'BLOCKED');write(policyFile,dbPolicy);});
 test('cannot replace real checks by unit',()=>{const p=structuredClone(dbPolicy);p.surfaces[1].checks.forEach(c=>c.evidence='unit');write(policyFile,p);assert.equal(run().result,'BLOCKED');write(policyFile,dbPolicy);});
 test('symlink policy refused',()=>{fs.renameSync(path.join(root,policyFile),path.join(root,'preserved.json'));fs.symlinkSync(path.join(root,'preserved.json'),path.join(root,policyFile));assert.equal(run().result,'BLOCKED');fs.unlinkSync(path.join(root,policyFile));fs.renameSync(path.join(root,'preserved.json'),path.join(root,policyFile));});
 test('lock refused',()=>{write('.yam/testing/lock','owner');assert.equal(run().result,'BLOCKED');fs.unlinkSync(path.join(root,'.yam/testing/lock'));});
 test('hardlink note refused',()=>{fs.linkSync(path.join(root,'.yam/testing/notes.md'),path.join(root,'hardlink-note'));assert.equal(run().result,'BLOCKED');fs.unlinkSync(path.join(root,'hardlink-note'));});
 const bin=path.resolve('dist/bin/yam.js');
 test('packaged CLI surface',()=>{const r=spawnSync(process.execPath,[bin,'test-check','--help'],{encoding:'utf8'});assert.equal(r.status,0);assert.match(r.stdout,/test-check run/);});
 test('deleted policy cannot disable gate',()=>{
   const bytes=fs.readFileSync(path.join(root,policyFile));fs.unlinkSync(path.join(root,policyFile));
   assert.equal(testCheckStop(root,true,'Done').decision,'block');assert.equal(checkTestCheck(root).result,'BLOCKED');write(policyFile,bytes.toString());
 });
 test('tree ID cannot stand in for source commit',()=>assert.equal(checkTestCheck(root,{stage:'push',source:git('rev-parse','HEAD^{tree}')}).result,'BLOCKED'));
 test('actual Stop protocol',()=>{
   const input={cwd:root,session_id:'test-'+path.basename(root),turn_id:'turn',hook_event_name:'UserPromptSubmit',prompt:'Change feature'};
   const invoke=body=>{const x=spawnSync(process.execPath,[bin,'hook','run','study-note'],{cwd:root,encoding:'utf8',input:JSON.stringify(body)});assert.equal(x.status,0,x.stderr);return JSON.parse(x.stdout);};
   invoke(input);write('feature.ts','stop-change');
   const stop={...input,hook_event_name:'Stop',last_assistant_message:'Done',stop_hook_active:true};
   assert.equal(invoke(stop).decision,'block');
   assert.equal(invoke({...stop,last_assistant_message:'Test check: BLOCKED; actual DB unavailable'}).continue,true);
   write('feature.ts','new');
 });
 test('Security check rejects stale Test check',()=>{
   const x=spawnSync(process.execPath,[bin,'security','check','--stage','commit'],{cwd:root,encoding:'utf8'});
   assert.equal(x.status,1);const report=JSON.parse(x.stdout);assert(report.result.errors.includes('test_check_blocked'));
 });
 const result={schema:'yam.test-check-smoke.v1',status:'passed',assertions:count,cases:results,scope:'real subprocess/Git/filesystem; DB observations fixture only'};
 if(process.argv.includes('--json'))console.log(JSON.stringify(result));else console.log(`test-check smoke: PASS (${count} assertions; DB protocol fixture only)`);
} finally { delete process.env.YAM_FIXTURE_MODE;fs.rmSync(root,{recursive:true,force:true}); }
