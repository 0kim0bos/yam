#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  compareProtectedFiles,
  emitScore,
  importWorkspaceModule,
  readWorkspaceText,
  requireWorkspace,
  runNodeTests,
} from '../../scripts/scorer-utils.mjs';

const fixtureRoot = path.dirname(fileURLToPath(import.meta.url));

main().catch((error) => emitScore({
  schema: 'yam.ab-score.v1',
  fixture_id: 'native-query-parser',
  pass: false,
  error: error instanceof Error ? error.message : String(error),
}));

async function main() {
  const workspace = requireWorkspace(process.argv[2]);
  const nodeTests = runNodeTests(workspace);
  const protectedFiles = await compareProtectedFiles(fixtureRoot, workspace, [
    'package.json',
    'tests/campaign-source.test.mjs',
  ]);
  const implementation = await readWorkspaceText(workspace, 'src/campaign-source.mjs');
  let behavior;
  try {
    const { campaignSource } = await importWorkspaceModule(workspace, 'src/campaign-source.mjs');
    behavior = {
      decoded_value: { pass: campaignSource('https://e.test/?utm_source=summer%20sale') === 'summer sale' },
      plus_decoding: { pass: campaignSource('https://e.test/?utm_source=email+digest') === 'email digest' },
      similar_name: {
        pass: campaignSource('https://e.test/?utm_source_extra=wrong&utm_source=right') === 'right',
      },
      missing_value: { pass: campaignSource('https://e.test/?page=1') === '' },
    };
  } catch (error) {
    behavior = {
      module_load: { pass: false, error: error instanceof Error ? error.message : String(error) },
    };
  }
  const usesNativeParser = /\bnew\s+URL\s*\(/.test(implementation);
  const behaviorPass = Object.values(behavior).every((check) => check.pass);
  const checks = {
    node_tests: nodeTests,
    protected_files: protectedFiles,
    native_parser: { pass: usesNativeParser },
    hidden_behavior: { pass: behaviorPass, cases: behavior },
  };
  emitScore({
    schema: 'yam.ab-score.v1',
    fixture_id: 'native-query-parser',
    pass: nodeTests.pass && protectedFiles.pass && usesNativeParser && behaviorPass,
    checks,
  });
}
