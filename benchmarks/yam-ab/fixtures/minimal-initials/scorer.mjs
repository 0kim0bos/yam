#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  compareProtectedFiles,
  emitScore,
  importWorkspaceModule,
  listWorkspaceFiles,
  requireWorkspace,
  runNodeTests,
} from '../../scripts/scorer-utils.mjs';

const fixtureRoot = path.dirname(fileURLToPath(import.meta.url));

main().catch((error) => emitScore({
  schema: 'yam.ab-score.v1',
  fixture_id: 'minimal-initials',
  pass: false,
  error: error instanceof Error ? error.message : String(error),
}));

async function main() {
  const workspace = requireWorkspace(process.argv[2]);
  const nodeTests = runNodeTests(workspace);
  const protectedFiles = await compareProtectedFiles(fixtureRoot, workspace, [
    'package.json',
    'tests/initials.test.mjs',
  ]);
  let behavior;
  try {
    const { initials } = await importWorkspaceModule(workspace, 'src/initials.mjs');
    behavior = {
      repeated_whitespace: { pass: initials('  Ada   Lovelace  ') === 'AL' },
      single_name: { pass: initials('Prince') === 'P' },
      empty_name: { pass: initials('   ') === '' },
      non_string: { pass: initials(null) === '' },
    };
  } catch (error) {
    behavior = {
      module_load: { pass: false, error: error instanceof Error ? error.message : String(error) },
    };
  }
  const sourceFiles = await listWorkspaceFiles(workspace, 'src');
  const noUnrelatedSource = sourceFiles.every((file) => file === 'initials.mjs');
  const behaviorPass = Object.values(behavior).every((check) => check.pass);
  const checks = {
    node_tests: nodeTests,
    protected_files: protectedFiles,
    hidden_behavior: { pass: behaviorPass, cases: behavior },
    no_unrelated_source_files: { pass: noUnrelatedSource, files: sourceFiles },
  };
  emitScore({
    schema: 'yam.ab-score.v1',
    fixture_id: 'minimal-initials',
    pass: nodeTests.pass && protectedFiles.pass && behaviorPass && noUnrelatedSource,
    checks,
  });
}
