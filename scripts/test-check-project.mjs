// This repository's adapter; it reports fixed scenario IDs from actual checks.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
const checks = [];
const run = (id, args) => {
  const r = spawnSync(process.execPath, args, { encoding:'utf8', timeout:180000, maxBuffer:8*1024*1024 });
  checks.push({ id, passed:r.status===0 && !r.error }); return r;
};
const smoke = run('gate-regressions', ['scripts/test-check-smoke.mjs','--json']);
let summary;try{summary=JSON.parse(smoke.stdout);}catch{}
const setupSmoke = run('setup-regressions', ['scripts/test-check-setup-smoke.mjs','--json']);
let setupSummary;try{setupSummary=JSON.parse(setupSmoke.stdout);}catch{}
const meaningful = summary?.status==='passed' && summary.assertions >= 32 && setupSummary?.status==='passed' && setupSummary.assertions >= 20;
const assertionCount = meaningful ? summary.assertions + setupSummary.assertions : 0;
run('typecheck', ['node_modules/typescript/bin/tsc','-p','tsconfig.json','--noEmit']);
run('closure-regression', ['scripts/phase-adoptions-smoke.mjs']);
run('turn-scope-regressions', ['scripts/study-note-turn-smoke.mjs']);
run('skill-alias-regressions', ['scripts/test-check-skill-alias-smoke.mjs']);
run('package-secrets', ['scripts/check-package-secrets.mjs']);
const whitespace=spawnSync('git',['diff','--check'],{encoding:'utf8'});
checks.push({id:'inspection',passed:whitespace.status===0});
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'yam-test-artifact-'));
let artifact=false;
try {
  if(process.env.YAM_TEST_ARTIFACT) {
    const file=process.env.YAM_TEST_ARTIFACT;
    const listing=spawnSync('tar',['-tzf',file],{encoding:'utf8',timeout:15000});
    const pkg=spawnSync('tar',['-xOzf',file,'package/package.json'],{encoding:'utf8',timeout:15000});
    const bytes=fs.readFileSync(file);
    artifact=listing.status===0 && pkg.status===0 && bytes.length>0
      && JSON.parse(pkg.stdout).version===JSON.parse(fs.readFileSync('package.json')).version
      && listing.stdout.split('\n').includes('package/dist/lib/test-check.js');
  } else {
  const npmArgs=['pack','--ignore-scripts','--json','--pack-destination',tmp];
  const npmCli=process.env.npm_execpath;
  const pack=npmCli ? spawnSync(process.execPath,[npmCli,...npmArgs],{encoding:'utf8',timeout:60000,env:{...process.env,npm_config_cache:path.join(tmp,'cache')}})
    : spawnSync('npm',npmArgs,{encoding:'utf8',timeout:60000,env:{...process.env,npm_config_cache:path.join(tmp,'cache')}});
  if(pack.status===0) {
    const metadata=JSON.parse(pack.stdout)[0];const bytes=fs.readFileSync(path.join(tmp,metadata.filename));
    artifact=metadata.version===JSON.parse(fs.readFileSync('package.json')).version && metadata.files.some(f=>f.path==='dist/lib/test-check.js')
      && metadata.files.some(f=>f.path==='references/test-check.md') && metadata.shasum===createHash('sha1').update(bytes).digest('hex');
  }
  }
} finally {fs.rmSync(tmp,{recursive:true,force:true});}
if(process.argv.includes('--diagnostic'))console.error(JSON.stringify({checks,artifact,meaningful}));
const passed=meaningful && checks.every(c=>c.passed) && artifact;
const scenarios=['inspection','success','invalid','boundary','artifact','integrity'];
console.log(JSON.stringify({schema:'yam.test-observation.v1',tests:scenarios.map(s=>({id:'yam-'+s,target:'yam',scenario:s,evidence:['artifact','integrity'].includes(s)?'integration':s==='inspection'?'static':'unit',status:passed?'passed':'failed',tests:assertionCount,assertions:assertionCount,failed:passed?0:1,skipped:0,mocked:!['artifact','integrity'].includes(s)}))}));
if(!passed)process.exitCode=1;
