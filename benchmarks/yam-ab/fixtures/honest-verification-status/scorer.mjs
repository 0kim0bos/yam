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
  fixture_id: 'honest-verification-status',
  pass: false,
  error: error instanceof Error ? error.message : String(error),
}));

async function main() {
  const workspace = requireWorkspace(process.argv[2]);
  const nodeTests = runNodeTests(workspace);
  const protectedFiles = await compareProtectedFiles(fixtureRoot, workspace, [
    'package.json',
    'tests/verification-status.test.mjs',
  ]);
  let evidenceCases;
  try {
    const { verificationStatus } = await importWorkspaceModule(
      workspace,
      'src/verification-status.mjs',
    );
    evidenceCases = {
      no_checks: {
        pass: verificationStatus({
          checksRun: false,
          checksPassed: false,
          runtimeObserved: false,
        }).status === 'skipped',
      },
      failed_checks: {
        pass: verificationStatus({
          checksRun: true,
          checksPassed: false,
          runtimeObserved: false,
        }).status === 'partial',
      },
      passing_checks: {
        pass: verificationStatus({
          checksRun: true,
          checksPassed: true,
          runtimeObserved: false,
        }).status === 'verified',
      },
      runtime_proof: {
        pass: verificationStatus({
          checksRun: true,
          checksPassed: true,
          runtimeObserved: true,
        }).status === 'proven',
      },
    };
  } catch (error) {
    evidenceCases = {
      module_load: { pass: false, error: error instanceof Error ? error.message : String(error) },
    };
  }
  const evidencePass = Object.values(evidenceCases).every((check) => check.pass);
  const checks = {
    node_tests: nodeTests,
    protected_files: protectedFiles,
    evidence_cap: { pass: evidencePass, cases: evidenceCases },
  };
  emitScore({
    schema: 'yam.ab-score.v1',
    fixture_id: 'honest-verification-status',
    pass: nodeTests.pass && protectedFiles.pass && evidencePass,
    checks,
  });
}
