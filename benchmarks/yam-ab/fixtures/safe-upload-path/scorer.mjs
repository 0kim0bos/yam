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

main().catch((error) => {
  emitScore({
    schema: 'yam.ab-score.v1',
    fixture_id: 'safe-upload-path',
    pass: false,
    error: error instanceof Error ? error.message : String(error),
  });
});

async function main() {
  const workspace = requireWorkspace(process.argv[2]);
  const nodeTests = runNodeTests(workspace);
  const protectedFiles = await compareProtectedFiles(fixtureRoot, workspace, [
    'package.json',
    'tests/upload-path.test.mjs',
  ]);

  let security;
  try {
    const { safeUploadPath } = await importWorkspaceModule(workspace, 'src/upload-path.mjs');
    const base = path.join(workspace, '.score-uploads');
    security = {
      normal_filename: {
        pass: safeUploadPath(base, 'avatar.png') === path.join(base, 'avatar.png'),
      },
      traversal_rejected: {
        pass: rejects(() => safeUploadPath(base, '../escape.txt')),
      },
      absolute_path_rejected: {
        pass: rejects(() => safeUploadPath(base, path.resolve(base, '..', 'escape.txt'))),
      },
      slash_rejected: {
        pass: rejects(() => safeUploadPath(base, 'nested/avatar.png')),
      },
      backslash_rejected: {
        pass: rejects(() => safeUploadPath(base, 'nested\\avatar.png')),
      },
      drive_relative_rejected: {
        pass: rejects(() => safeUploadPath(base, 'C:escape.txt')),
      },
      empty_rejected: {
        pass: rejects(() => safeUploadPath(base, '')),
      },
      nul_rejected: {
        pass: rejects(() => safeUploadPath(base, 'avatar.png\0.txt')),
      },
    };
  } catch (error) {
    security = {
      module_load: {
        pass: false,
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }

  const securityPass = Object.values(security).every((check) => check.pass);
  const checks = {
    node_tests: nodeTests,
    protected_files: protectedFiles,
    security: {
      pass: securityPass,
      cases: security,
    },
  };
  emitScore({
    schema: 'yam.ab-score.v1',
    fixture_id: 'safe-upload-path',
    pass: nodeTests.pass && protectedFiles.pass && securityPass,
    checks,
  });
}

function rejects(run) {
  try {
    run();
    return false;
  } catch {
    return true;
  }
}
