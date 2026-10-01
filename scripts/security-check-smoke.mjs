import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSecurityStarter, validateSecurityCheck, persistSecurityCheck, SEC_AREAS } from '../dist/lib/security-check.js';
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'yam-security-'));
const policy = { version: 'security-check-v1', required_at: Object.fromEntries(Object.keys(SEC_AREAS).map(id => [id, ['commit','push','deploy']])) };
const starter = () => createSecurityStarter({stage:'commit',policy,binding:{stage:'commit',staged_tree:'a'.repeat(40),base_revision:'b'.repeat(40)},environment:'local',scope:['fixture'],checker:'fixture'});
const good = () => {const x=starter(); for(const a of x.areas) a.status='passed',a.evidence=[{reference:'evidence.json',sha256:'sha256:'+'c'.repeat(64),checker:'fixture',checked_at:new Date().toISOString(),result:'passed'}];return x;};
try {
 assert.equal(validateSecurityCheck(starter()).result,'BLOCKED');
 const x=good(); assert.equal(validateSecurityCheck(x,x.binding,policy).result,'PASS');
 for(const mutate of [
  x=>x.areas.pop(), x=>x.areas.push(x.areas[0]), x=>x.areas[0].evidence=[],
  x=>x.areas[0].explanation='label only', x=>x.areas[0].required_at=[],
  x=>x.areas[0].status='not_applicable', x=>x.run_id='../escape',
  x=>x.areas[0].evidence=[null], x=>x.areas[0].evidence={},
  x=>x.scope=['line\ninjection'], x=>x.areas[1].status='needs_improvement'
 ]) {const bad=structuredClone(x);mutate(bad);assert.equal(validateSecurityCheck(bad,x.binding,policy).result,'BLOCKED');}
 const altered=structuredClone(x.binding);altered.nested={commit:'new'};assert.equal(validateSecurityCheck(x,altered,policy).result,'BLOCKED');
 const def=good();def.policy.required_at['SEC-05']=['deploy'];def.areas[4].required_at=['deploy'];def.areas[4].status='unverified';assert.equal(validateSecurityCheck(def,def.binding,def.policy).result,'PASS');
 const persisted=await persistSecurityCheck(tmp,x);assert.equal(persisted.result.result,'PASS');
 await assert.rejects(()=>persistSecurityCheck(tmp,x),/security_run_exists/);
 const attempts=Array.from({length:8},()=>good());await Promise.all(attempts.map(a=>persistSecurityCheck(tmp,a)));
 const note=await fs.readFile(path.join(tmp,'.yam/security/notes.md'),'utf8');assert.equal((note.match(/-- Security check --/g)||[]).length,9);assert.match(note,/신뢰 경계/);
 const missing=starter();const forged={...validateSecurityCheck(missing),result:'PASS',errors:[],blocking:[]};const saved=await persistSecurityCheck(tmp,missing,forged);assert.equal(saved.result.result,'BLOCKED');
 const leak=good();leak.checker='https://user:password@example.org';const redacted=await persistSecurityCheck(tmp,leak);assert.equal(redacted.result.result,'BLOCKED');assert(!JSON.stringify(redacted).includes('password@example'));
 const victim=path.join(tmp,'victim');await fs.writeFile(victim,'unchanged');await fs.symlink(victim,path.join(tmp,'linked-note'));await assert.rejects(()=>persistSecurityCheck(tmp,good(),undefined,{notePath:path.join(tmp,'linked-note')}),/symlink/);assert.equal(await fs.readFile(victim,'utf8'),'unchanged');
 const redirected=path.join(tmp,'redirect');await fs.mkdir(redirected);const repo=path.join(tmp,'repo');await fs.mkdir(repo);await fs.symlink(redirected,path.join(repo,'.yam'));await assert.rejects(()=>persistSecurityCheck(repo,good()),/symlink/);assert.deepEqual(await fs.readdir(redirected),[]);
 console.log('security-check smoke: PASS (schema, evidence, mandatory rules, nested binding, deferral, append/concurrency, forged PASS, redaction, symlinks)');
} finally {await fs.rm(tmp,{recursive:true,force:true});}
