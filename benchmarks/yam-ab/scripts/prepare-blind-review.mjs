#!/usr/bin/env node
import { prepareBlindReview } from './blind-review-utils.mjs';

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const runDirectory = valueAfter('--run-dir');
  if (!runDirectory) {
    throw new Error('usage: prepare-blind-review.mjs --run-dir <completed-run-directory>');
  }
  const result = await prepareBlindReview(runDirectory);
  console.log(JSON.stringify({
    ok: true,
    run_directory: result.runDirectory,
    comparisons: result.packet.comparisons.length,
    reviewer_files: [
      'review-packet.json',
      'blind-reviews.template.json',
    ],
    private_file: 'unblinding-key.json',
  }));
}

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? '' : process.argv[index + 1] || '';
}
