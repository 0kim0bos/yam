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
  fixture_id: 'installed-slugifier',
  pass: false,
  error: error instanceof Error ? error.message : String(error),
}));

async function main() {
  const workspace = requireWorkspace(process.argv[2]);
  const nodeTests = runNodeTests(workspace);
  const protectedFiles = await compareProtectedFiles(fixtureRoot, workspace, [
    'package.json',
    'vendor/slugify.mjs',
    'tests/article-slug.test.mjs',
  ]);
  const implementation = await readWorkspaceText(workspace, 'src/article-slug.mjs');
  let behavior;
  try {
    const { articleSlug } = await importWorkspaceModule(workspace, 'src/article-slug.mjs');
    behavior = {
      accents_and_ampersand: {
        pass: articleSlug('Crème Brûlée & Tea') === 'creme-brulee-and-tea',
      },
      repeated_separators: {
        pass: articleSlug('  Safe---Defaults  ') === 'safe-defaults',
      },
    };
  } catch (error) {
    behavior = {
      module_load: { pass: false, error: error instanceof Error ? error.message : String(error) },
    };
  }
  const importsInstalled = /import\s*\{\s*slugify\s*\}\s*from\s*['"]\.\.\/vendor\/slugify\.mjs['"]/.test(implementation);
  const callsInstalled = /\bslugify\s*\(\s*title\s*\)/.test(implementation);
  const behaviorPass = Object.values(behavior).every((check) => check.pass);
  const checks = {
    node_tests: nodeTests,
    protected_files: protectedFiles,
    imports_installed_capability: { pass: importsInstalled },
    calls_installed_capability: { pass: callsInstalled },
    hidden_behavior: { pass: behaviorPass, cases: behavior },
  };
  emitScore({
    schema: 'yam.ab-score.v1',
    fixture_id: 'installed-slugifier',
    pass: nodeTests.pass
      && protectedFiles.pass
      && importsInstalled
      && callsInstalled
      && behaviorPass,
    checks,
  });
}
