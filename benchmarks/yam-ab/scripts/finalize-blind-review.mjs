#!/usr/bin/env node
import fsp from 'node:fs/promises';
import path from 'node:path';
import { finalizeBlindReview } from './blind-review-utils.mjs';
import { requireExistingTempDirectory, writeJsonAtomic } from './experiment-utils.mjs';

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const runDirectoryValue = valueAfter('--run-dir');
  const reviewsValue = valueAfter('--reviews');
  if (!runDirectoryValue || !reviewsValue) {
    throw new Error(
      'usage: finalize-blind-review.mjs --run-dir <completed-run-directory> --reviews <completed-reviews.json>',
    );
  }
  const runDirectory = await requireExistingTempDirectory(runDirectoryValue);
  const [contract, summary, key, reviews] = await Promise.all([
    readJson(path.join(runDirectory, 'run-contract.json')),
    readJson(path.join(runDirectory, 'summary.json')),
    readJson(path.join(runDirectory, 'unblinding-key.json')),
    readJson(path.resolve(reviewsValue)),
  ]);
  const decision = finalizeBlindReview({ contract, summary, key, reviews });
  await writeJsonAtomic(path.join(runDirectory, 'final-decision.json'), decision);
  console.log(JSON.stringify(decision));
}

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? '' : process.argv[index + 1] || '';
}

async function readJson(file) {
  return JSON.parse(await fsp.readFile(file, 'utf8'));
}
