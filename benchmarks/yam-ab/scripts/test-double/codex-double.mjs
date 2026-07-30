#!/usr/bin/env node
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const benchmarkRoot = path.resolve(scriptDir, '../..');
const args = process.argv.slice(2);

if (args.includes('--version')) {
  console.log('codex-cli 0.146.0');
  process.exit(0);
}
if (args[0] === 'login' && args[1] === 'status') {
  console.log('Logged in with benchmark test double');
  process.exit(0);
}
if (args[0] !== 'exec') {
  console.error('unsupported test-double command');
  process.exit(2);
}

const workspace = valueAfter('--cd');
const prompt = await readStdin();
if (!workspace) throw new Error('test double missing required workspace');

if (prompt.includes('This is an isolation canary.')) {
  const marker = prompt.match(/yam-ab-canary-[A-Za-z0-9-]+/)?.[0];
  if (!marker) throw new Error('test double could not find canary marker');
  await fsp.writeFile(path.join(workspace, 'canary.txt'), `${marker}\n`);
} else {
  const fixtureId = prompt.match(/fixture_id:\s*([a-z0-9-]+)/)?.[1];
  if (!fixtureId) throw new Error('test double could not find fixture id');
  await fsp.cp(
    path.join(benchmarkRoot, 'fixtures', fixtureId, 'references', 'good'),
    workspace,
    { recursive: true },
  );
}

const finalMessage = JSON.stringify({
  summary: 'Benchmark test double completed the controlled task.',
  files_changed: prompt.includes('isolation canary') ? ['canary.txt'] : ['fixture mutable file'],
  tests_run: ['simulated'],
  remaining_uncertainty: [],
});

console.log(JSON.stringify({ type: 'thread.started', thread_id: 'test-double-thread' }));
console.log(JSON.stringify({ type: 'turn.started' }));
console.log(JSON.stringify({
  type: 'item.completed',
  item: {
    id: 'item-1',
    type: 'file_change',
    status: 'completed',
  },
}));
console.log(JSON.stringify({
  type: 'item.completed',
  item: {
    id: 'item-2',
    type: 'agent_message',
    text: finalMessage,
  },
}));
console.log(JSON.stringify({
  type: 'turn.completed',
  usage: {
    input_tokens: 1000,
    cached_input_tokens: 400,
    output_tokens: 200,
    reasoning_output_tokens: 50,
  },
}));

function valueAfter(flag) {
  const index = args.indexOf(flag);
  return index === -1 ? '' : args[index + 1] || '';
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}
