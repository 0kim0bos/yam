import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readMemoryDirectory } from '../dist/lib/memory-records.js';

const cli = fileURLToPath(new URL('../dist/bin/yam.js', import.meta.url));
const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'yam-memory-completeness-'));
const recordsDir = path.join(root, '.yam', 'memory', 'records');
const summaryPath = path.join(root, '.yam', 'memory', 'summary.md');
const sentinel = 'Existing trusted summary must survive incomplete reads.\n';
const record = { schemaVersion: 1, id: 'mem-smoke', kind: 'lesson', status: 'active', summary: 'Keep evidence honest.', createdAt: '2026-10-02T00:00:00.000Z' };
const faultPreload = `import fsp from 'node:fs/promises';
const method = process.env.YAM_MEMORY_SMOKE_FAULT;
const original = fsp[method];
fsp[method] = async function (target, ...args) {
  const value = String(target);
  if ((method === 'readFile' && value.endsWith('/records/mem-smoke.json')) || (method !== 'readFile' && value.endsWith('/records'))) {
    throw Object.assign(new Error('secret-canary-DO-NOT-PRINT'), { code: process.env.YAM_MEMORY_SMOKE_CODE });
  }
  return original.call(this, target, ...args);
};`;
function run(args, fault = '', code = 'EACCES') {
  const result = spawnSync(process.execPath, [
    ...(fault ? ['--import', `data:text/javascript,${encodeURIComponent(faultPreload)}`] : []), cli, 'memory', ...args, root, '--json'
  ], { encoding: 'utf8', env: { ...process.env, YAM_MEMORY_SMOKE_FAULT: fault, YAM_MEMORY_SMOKE_CODE: code } });
  assert.equal(result.error, undefined);
  assert(!`${result.stdout}${result.stderr}`.includes('secret-canary'));
  return { result, report: JSON.parse(result.stdout) };
}
try {
  let output = run(['list']);
  assert.equal(output.report.state, 'missing');
  assert.equal(output.result.status, 0);
  output = run(['summary']);
  assert.equal(output.report.state, 'missing');
  assert.equal(output.report.summary_written, false);
  assert.equal(output.result.status, 1);
  await assert.rejects(fsp.access(summaryPath), { code: 'ENOENT' });

  await fsp.mkdir(recordsDir, { recursive: true });
  assert.equal((await readMemoryDirectory(recordsDir)).state, 'empty');
  assert.deepEqual(run(['list']).report, [], 'valid list JSON stays compatible');
  assert.equal(run(['summary']).report.state, 'empty');
  await fsp.writeFile(path.join(recordsDir, 'mem-smoke.json'), JSON.stringify(record));
  assert.deepEqual(run(['list']).report, [record]);
  assert.equal(run(['summary']).report.summary_written, true);
  assert.match(await fsp.readFile(summaryPath, 'utf8'), /Active records: 1/);

  for (const [fault, code, expected] of [
    ['access', 'EACCES', 'unreadable'], ['access', 'ENOENT', 'missing'],
    ['readdir', 'EIO', 'unreadable'], ['readdir', 'ENOENT', 'incomplete'],
    ['readFile', 'EPERM', 'unreadable'], ['readFile', 'ENOENT', 'unreadable']
  ]) {
    await fsp.writeFile(summaryPath, sentinel);
    output = run(['summary'], fault, code);
    assert.equal(output.result.status, 1, `${fault}:${code}`);
    assert.equal(output.report.state, expected);
    assert.equal(output.report.summary_written, false);
    assert.equal(await fsp.readFile(summaryPath, 'utf8'), sentinel);
    assert.equal(run(['list'], fault, code).report.state, expected);
  }

  for (const invalid of ['{"secret":"secret-canary', 'null', '[]', '{}', JSON.stringify({ ...record, status: 'invalid' })]) {
    await fsp.writeFile(path.join(recordsDir, 'mem-smoke.json'), invalid);
    await fsp.writeFile(summaryPath, sentinel);
    output = run(['summary']);
    assert.equal(output.result.status, 1);
    assert.equal(output.report.state, 'invalid');
    assert.equal(await fsp.readFile(summaryPath, 'utf8'), sentinel);
  }
  await fsp.writeFile(path.join(recordsDir, 'mem-smoke.json'), JSON.stringify(record));
  await fsp.writeFile(path.join(recordsDir, 'broken.json'), '{');
  output = run(['summary']);
  assert.equal(output.report.state, 'incomplete');
  assert.equal(output.report.records.length, 1);
  assert.equal(output.report.summary_written, false);
  assert.equal(await fsp.readFile(summaryPath, 'utf8'), sentinel);
  await fsp.rm(path.join(recordsDir, 'broken.json'));

  // Injectable IO makes diagnostics limits deterministic without permission/root assumptions.
  const fakeIo = {
    access: async () => {},
    readdir: async () => Array.from({ length: 30 }, (_, i) => ({ name: `secret-canary-${i}.json`, isFile: () => true })),
    readFile: async () => '{secret-canary'
  };
  const bounded = await readMemoryDirectory(recordsDir, fakeIo);
  assert.equal(bounded.state, 'invalid');
  assert.equal(bounded.diagnostics.length, 20);
  assert.equal(bounded.diagnostics_truncated, true);
  assert(!JSON.stringify(bounded).includes('secret-canary'));
  console.log('memory-completeness-smoke: ok (valid CLI compatibility, missing/empty, injected access/readdir/read failures, invalid records, summary preservation, redacted bounded diagnostics)');
} finally {
  await fsp.rm(root, { recursive: true, force: true });
  await assert.rejects(fsp.access(root), { code: 'ENOENT' });
}
