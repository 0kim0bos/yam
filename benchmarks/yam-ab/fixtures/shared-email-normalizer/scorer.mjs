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
  fixture_id: 'shared-email-normalizer',
  pass: false,
  error: error instanceof Error ? error.message : String(error),
}));

async function main() {
  const workspace = requireWorkspace(process.argv[2]);
  const nodeTests = runNodeTests(workspace);
  const protectedFiles = await compareProtectedFiles(fixtureRoot, workspace, [
    'package.json',
    'src/create-user.mjs',
    'src/invite-user.mjs',
    'tests/create-user.test.mjs',
  ]);
  let behavior;
  try {
    const [{ createUser }, { inviteUser }] = await Promise.all([
      importWorkspaceModule(workspace, 'src/create-user.mjs'),
      importWorkspaceModule(workspace, 'src/invite-user.mjs'),
    ]);
    behavior = {
      create_user: {
        pass: createUser('  ADA@EXAMPLE.COM ').email === 'ada@example.com',
      },
      invite_user: {
        pass: inviteUser('  GRACE@EXAMPLE.COM ').invitedEmail === 'grace@example.com',
      },
    };
  } catch (error) {
    behavior = {
      module_load: { pass: false, error: error instanceof Error ? error.message : String(error) },
    };
  }
  const behaviorPass = Object.values(behavior).every((check) => check.pass);
  const checks = {
    node_tests: nodeTests,
    protected_files: protectedFiles,
    shared_behavior: { pass: behaviorPass, cases: behavior },
  };
  emitScore({
    schema: 'yam.ab-score.v1',
    fixture_id: 'shared-email-normalizer',
    pass: nodeTests.pass && protectedFiles.pass && behaviorPass,
    checks,
  });
}
