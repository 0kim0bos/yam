import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {collectSecurityBinding,runSecurityCommand} from '../dist/lib/security-integration.js';
import {createSecurityStarter} from '../dist/lib/security-check.js';
const cli=fileURLToPath(new URL('../dist/bin/yam.js',import.meta.url));
const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'yam-security-git-'));
const cwd=await fs.realpath(tmp);
const git=(...a)=>execFileSync('git',['-C',cwd,...a],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const hash=b=>'sha256:'+createHash('sha256').update(b).digest('hex');
const run=a=>runSecurityCommand(a,{cwd,cliPath:cli});
try {
 git('init');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
 await fs.writeFile(path.join(cwd,'file.txt'),'base');git('add','file.txt');git('commit','-m','base');
 assert.equal((await run(['init'])).ok,true);assert.equal((await run(['init'])).ok,false);
 const policyText=await fs.readFile(path.join(cwd,'.yam/security/policy.json'),'utf8');const policy=JSON.parse(policyText);const pin=hash(policyText);
 const evidenceFile=path.join(cwd,'.yam/security/check.json');const data=Buffer.from('review evidence fixture');await fs.writeFile(path.join(cwd,'.yam/security/proof.bin'),data);
 async function prepare(stage,args=[],stdin='') {
  const normal=stage==='ci'?'push':stage;
  const binding=collectSecurityBinding(cwd,stage,new Map(args.reduce((out,x,i)=>i%2?out:[...out,[x,args[i+1]]],[])),stdin);
  const input=createSecurityStarter({stage:normal,policy,binding,environment:stage==='deploy'?'test':'local',scope:['fixture'],checker:'fixture'});
  input.policy_digest=pin;
  for(const area of input.areas) {area.status='passed';area.evidence=[{reference:'.yam/security/proof.bin',sha256:hash(data),checker:'fixture',checked_at:new Date().toISOString(),result:'passed'}];}
  await fs.writeFile(evidenceFile,JSON.stringify(input));return input;
 }
 const blocked=await run(['check','--stage','commit']);assert.equal(blocked.ok,false);assert.equal(blocked.result.result,'BLOCKED');
 await prepare('commit');assert.equal((await run(['check','--stage','commit'])).ok,true);
 assert.equal((await run(['check','--stage','invalid'])).ok,false);
 assert.equal((await run(['check','--unknown','value'])).ok,false);
 await fs.writeFile(path.join(cwd,'file.txt'),'unstaged');assert.equal((await run(['check','--stage','commit'])).ok,true);
 git('add','file.txt');assert.equal((await run(['check','--stage','commit'])).ok,false);
 await prepare('commit');assert.equal((await run(['hooks','enable'])).ok,true);assert.equal((await run(['hooks','enable'])).ok,false);
 git('commit','-m','hook pass');
 await fs.writeFile(path.join(cwd,'file.txt'),'next');git('add','file.txt');
 let commit=spawnSync('git',['-C',cwd,'commit','-m','hook block'],{encoding:'utf8'});assert.notEqual(commit.status,0);
 git('commit','--no-verify','-m','bypass fixture');
 const source=git('rev-parse','HEAD');const base=git('rev-parse','HEAD^');
 const ci=['--source',source,'--base',base];await prepare('ci',ci);
 assert.equal((await run(['check','--stage','ci',...ci,'--policy-digest',pin])).ok,true);
 assert.equal((await run(['check','--stage','ci',...ci])).ok,false);
 assert.equal((await run(['check','--stage','ci','--source',base,'--base',source,'--policy-digest',pin])).ok,false);
 const remote=path.join(cwd,'remote.git');execFileSync('git',['init','--bare',remote],{stdio:'ignore'});git('remote','add','fixture',remote);
 const branch=git('symbolic-ref','HEAD');const stdin=`${branch} ${source} ${branch} ${'0'.repeat(40)}\n`;const push=['--remote','fixture','--destination',remote];await prepare('push',push,stdin);
 const result=await runSecurityCommand(['check','--stage','push',...push],{cwd,cliPath:cli,stdin});assert.equal(result.ok,true);
 git('push','fixture',branch);
 await fs.writeFile(path.join(cwd,'.yam/security/artifact.bin'),'artifact');await fs.writeFile(path.join(cwd,'.yam/security/config.bin'),'config');
 const deploy=['--source',source,'--artifact','.yam/security/artifact.bin','--configuration','.yam/security/config.bin','--artifact-digest',hash('artifact'),'--configuration-digest',hash('config'),'--environment','test'];
 await prepare('deploy',deploy);assert.equal((await run(['check','--stage','deploy',...deploy,'--policy-digest',pin])).ok,true);
 await fs.writeFile(path.join(cwd,'.yam/security/artifact.bin'),'altered');assert.equal((await run(['check','--stage','deploy',...deploy,'--policy-digest',pin])).ok,false);
 await prepare('commit');await fs.writeFile(path.join(cwd,'.yam/security/proof.bin'),'changed');assert.equal((await run(['check','--stage','commit'])).ok,false);
 const note=await fs.readFile(path.join(cwd,'.yam/security/notes.md'),'utf8');assert.match(note,/Result: PASS/);assert.match(note,/Result: BLOCKED/);assert.match(note,/SEC-09/);
 console.log('security integration smoke: PASS (actual staged tree, commit/push hooks, bypass CI recheck, policy pin, binary evidence, deployment artifact/config changes, notes)');
} finally {await fs.rm(tmp,{recursive:true,force:true});}
