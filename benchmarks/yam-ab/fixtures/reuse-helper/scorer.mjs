#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  compareProtectedFiles,
  emitScore,
  readWorkspaceText,
  requireWorkspace,
  runNodeTests,
} from '../../scripts/scorer-utils.mjs';

const fixtureRoot = path.dirname(fileURLToPath(import.meta.url));

main().catch((error) => {
  emitScore({
    schema: 'yam.ab-score.v1',
    fixture_id: 'reuse-helper',
    pass: false,
    error: error instanceof Error ? error.message : String(error),
  });
});

async function main() {
  const workspace = requireWorkspace(process.argv[2]);
  const nodeTests = runNodeTests(workspace);
  const protectedFiles = await compareProtectedFiles(fixtureRoot, workspace, [
    'package.json',
    'src/currency.mjs',
    'tests/invoice-summary.test.mjs',
  ]);
  const implementation = await readWorkspaceText(workspace, 'src/invoice-summary.mjs');
  const importsExistingHelper = /import\s*\{\s*formatCurrency\s*\}\s*from\s*['"]\.\/currency\.mjs['"]/.test(implementation);
  const callsExistingHelper = /formatCurrency\s*\(\s*invoice\.totalCents\s*\)/.test(implementation);
  const duplicatesFormatter = /Intl\.NumberFormat/.test(implementation);
  const checks = {
    node_tests: nodeTests,
    protected_files: protectedFiles,
    imports_existing_helper: { pass: importsExistingHelper },
    calls_existing_helper: { pass: callsExistingHelper },
    no_duplicate_formatter: { pass: !duplicatesFormatter },
  };
  emitScore({
    schema: 'yam.ab-score.v1',
    fixture_id: 'reuse-helper',
    pass: nodeTests.pass
      && protectedFiles.pass
      && importsExistingHelper
      && callsExistingHelper
      && !duplicatesFormatter,
    checks,
  });
}
