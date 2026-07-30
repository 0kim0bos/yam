#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  compareProtectedFiles,
  emitScore,
  importWorkspaceModule,
  requireWorkspace,
  runNodeTests,
} from '../../scripts/scorer-utils.mjs';

const fixtureRoot = path.dirname(fileURLToPath(import.meta.url));

main().catch((error) => emitScore({
  schema: 'yam.ab-score.v1',
  fixture_id: 'accessible-icon-button',
  pass: false,
  error: error instanceof Error ? error.message : String(error),
}));

async function main() {
  const workspace = requireWorkspace(process.argv[2]);
  const nodeTests = runNodeTests(workspace);
  const protectedFiles = await compareProtectedFiles(fixtureRoot, workspace, [
    'package.json',
    'tests/delete-button.test.mjs',
  ]);
  let accessibility;
  try {
    const { renderDeleteButton } = await importWorkspaceModule(workspace, 'src/delete-button.mjs');
    const html = renderDeleteButton();
    accessibility = {
      explicit_name: {
        pass: /<button\b[^>]*\baria-label=["']Delete invoice["'][^>]*>/i.test(html),
      },
      decorative_icon: {
        pass: /<svg\b[^>]*\baria-hidden=["']true["'][^>]*>/i.test(html),
      },
      button_type: {
        pass: /<button\b[^>]*\btype=["']button["'][^>]*>/i.test(html),
      },
    };
  } catch (error) {
    accessibility = {
      module_load: { pass: false, error: error instanceof Error ? error.message : String(error) },
    };
  }
  const accessibilityPass = Object.values(accessibility).every((check) => check.pass);
  const checks = {
    node_tests: nodeTests,
    protected_files: protectedFiles,
    accessibility: { pass: accessibilityPass, cases: accessibility },
  };
  emitScore({
    schema: 'yam.ab-score.v1',
    fixture_id: 'accessible-icon-button',
    pass: nodeTests.pass && protectedFiles.pass && accessibilityPass,
    checks,
  });
}
