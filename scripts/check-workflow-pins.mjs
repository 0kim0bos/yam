#!/usr/bin/env node
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const workflowDir = join(process.cwd(), '.github', 'workflows');
const files = readdirSync(workflowDir)
  .filter((name) => /\.ya?ml$/i.test(name))
  .sort();
const failures = [];
let actionCount = 0;

for (const file of files) {
  const lines = readFileSync(join(workflowDir, file), 'utf8').split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const match = line.match(/^\s*-?\s*uses:\s*([^\s#]+)/);
    if (!match) continue;
    const action = match[1];
    actionCount += 1;
    if (action.startsWith('./')) continue;
    const pinnedAction = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*@[a-f0-9]{40}$/i.test(action);
    const pinnedContainer = /^docker:\/\/[^\s]+@sha256:[a-f0-9]{64}$/i.test(action);
    if (!pinnedAction && !pinnedContainer) failures.push(`${file}:${index + 1}: ${action}`);
  }
}

if (!files.length || !actionCount || failures.length) {
  console.error('workflow-pins: failed');
  if (!files.length) console.error('no workflow files found');
  if (!actionCount) console.error('no action references found');
  for (const failure of failures) console.error(`unpinned action: ${failure}`);
  process.exit(1);
}

console.log(`workflow-pins: ok (${actionCount} action references across ${files.length} workflows)`);
