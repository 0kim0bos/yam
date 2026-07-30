#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  applyExternalUpdates,
  checkExternalUpdates
} from '../dist/lib/external-updates.js';

const roots = [];

try {
  const fixture = createFixture();
  const check = await checkExternalUpdates('2.4.0', fixture.dependencies());
  assert.equal(check.schema, 'yam.external-update-check.v1');
  assert.equal(check.success, true);
  assert.deepEqual(
    check.components.map((item) => [item.component, item.installed_version, item.latest_version, item.status]),
    [
      ['yam', '2.4.0', '2.5.0', 'update_available'],
      ['scrapling', '0.4.11', '0.4.12', 'update_available'],
      ['insane-search', '0.8.2', '0.9.0', 'update_available']
    ]
  );
  assert.equal(check.components[2].source_revision.drift, true);
  assert.match(check.components[2].source_revision.note, /plugin manifest version/);
  assert.equal(fixture.fetches.some((url) => url.includes('/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/')), true);
  assert.equal(fixture.fetches.some((url) => url.includes('/HEAD/')), false);

  const scraplingApply = await applyExternalUpdates('2.4.0', {
    component: 'scrapling'
  }, fixture.dependencies());
  assert.equal(scraplingApply.success, true, JSON.stringify(scraplingApply, null, 2));
  assert.equal(scraplingApply.receipts[0].outcome, 'updated');
  assert.equal(scraplingApply.receipts[0].installed_version, '0.4.12');
  assert.equal(scraplingApply.receipts[0].persistence, 'written');
  assert.equal(scraplingApply.receipts[0].source_revision.kind, 'pypi_release');
  assert.equal(existsSync(scraplingApply.receipts[0].receipt_path), true);
  assert.equal(existsSync(fixture.oldEnvironment), true, 'previous Scrapling environment must be retained');
  const newTarget = resolve(dirname(fixture.scraplingBin), readlinkSync(fixture.scraplingBin));
  assert.match(newTarget, /0\.4\.12-yam-/);
  assert.equal(existsSync(join(dirname(dirname(newTarget)), '.yam-scrapling-install.json')), true);

  const rollbackFixture = createFixture();
  const invalidReceiptDir = join(rollbackFixture.root, 'receipt-path-is-a-file');
  writeFileSync(invalidReceiptDir, 'not a directory\n');
  const originalTarget = resolve(dirname(rollbackFixture.scraplingBin), readlinkSync(rollbackFixture.scraplingBin));
  const rollbackApply = await applyExternalUpdates('2.4.0', {
    component: 'scrapling'
  }, rollbackFixture.dependencies({
    receiptDir: invalidReceiptDir
  }));
  assert.equal(rollbackApply.success, false);
  assert.equal(rollbackApply.receipts[0].outcome, 'failed');
  assert.equal(rollbackApply.receipts[0].persistence, 'failed');
  assert.equal(rollbackApply.receipts[0].rollback_hint.automatic, true);
  assert.equal(
    resolve(dirname(rollbackFixture.scraplingBin), readlinkSync(rollbackFixture.scraplingBin)),
    originalTarget,
    'receipt failure must restore the previous symlink'
  );

  const manualFixture = createFixture();
  manualFixture.addFails = true;
  const manualApply = await applyExternalUpdates('2.4.0', {
    component: 'insane-search'
  }, manualFixture.dependencies());
  assert.equal(manualApply.success, false);
  assert.equal(manualApply.receipts[0].outcome, 'manual_plugin_update_required');
  assert.equal(manualApply.receipts[0].persistence, 'written');
  assert.equal(JSON.stringify(manualApply).includes('fixture-secret'), false, 'captured command output must be redacted');
  assert.equal(manualFixture.commands.some((item) => item.args.includes('remove')), false);
  assert.equal(manualFixture.commands.some((item) => (
    [item.command, ...item.args].join(' ').includes('.codex/plugins/cache')
  )), false);

  const stateFailureFixture = createFixture();
  stateFailureFixture.pluginListFailsAfterUpgrade = true;
  const stateFailureApply = await applyExternalUpdates('2.4.0', {
    component: 'insane-search'
  }, stateFailureFixture.dependencies());
  assert.equal(stateFailureApply.success, false);
  assert.equal(stateFailureApply.receipts[0].outcome, 'failed');
  assert.match(stateFailureApply.receipts[0].error, /refusing a plugin mutation without observed state/);
  assert.equal(stateFailureFixture.commands.some((item) => item.args.includes('add')), false);

  const wrongSourceFixture = createFixture();
  wrongSourceFixture.marketplaceSource = 'https://example.invalid/untrusted.git';
  const wrongSourceApply = await applyExternalUpdates('2.4.0', {
    component: 'insane-search'
  }, wrongSourceFixture.dependencies());
  assert.equal(wrongSourceApply.success, false);
  assert.match(wrongSourceApply.receipts[0].error, /unexpected gptaku-codex marketplace source/);
  assert.equal(wrongSourceFixture.commands.some((item) => item.args.includes('upgrade')), false);

  const failedVenvFixture = createFixture();
  failedVenvFixture.venvFails = true;
  const failedVenvApply = await applyExternalUpdates('2.4.0', {
    component: 'scrapling'
  }, failedVenvFixture.dependencies());
  assert.equal(failedVenvApply.success, false);
  const failedCandidate = failedVenvFixture.commands.find((item) => (
    item.command === 'python3' && item.args[0] === '-m' && item.args[1] === 'venv'
  ))?.args[2];
  assert.ok(failedCandidate);
  assert.equal(existsSync(failedCandidate), false, 'a failed transaction-created venv must be removed');
  assert.equal(existsSync(failedVenvFixture.oldEnvironment), true);

  const cleanupFailureFixture = createFixture();
  cleanupFailureFixture.venvFails = true;
  const cleanupFailureDependencies = cleanupFailureFixture.dependencies();
  cleanupFailureDependencies.removeCandidate = async () => {
    throw new Error('fixture cleanup denied');
  };
  const cleanupFailureApply = await applyExternalUpdates('2.4.0', {
    component: 'scrapling'
  }, cleanupFailureDependencies);
  assert.equal(cleanupFailureApply.success, false);
  assert.equal(cleanupFailureApply.receipts[0].persistence, 'written');
  assert.equal(cleanupFailureApply.receipts[0].rollback_hint.automatic, false);
  assert.match(cleanupFailureApply.receipts[0].error, /candidate cleanup also failed: fixture cleanup denied/);
  assert.match(cleanupFailureApply.receipts[0].rollback_hint.guidance, /failed yam candidate/);

  const nonLinkFixture = createFixture();
  rmSync(nonLinkFixture.scraplingBin);
  writeFileSync(nonLinkFixture.scraplingBin, 'user-owned executable\n');
  const nonLinkApply = await applyExternalUpdates('2.4.0', {
    component: 'scrapling'
  }, nonLinkFixture.dependencies());
  assert.equal(nonLinkApply.success, false);
  assert.match(nonLinkApply.receipts[0].error, /refusing to replace non-symlink/);
  assert.equal(readFile(nonLinkFixture.scraplingBin), 'user-owned executable\n');

  const markerlessFixture = createFixture();
  rmSync(join(markerlessFixture.oldEnvironment, '.yam-scrapling-install.json'));
  const markerlessTarget = resolve(dirname(markerlessFixture.scraplingBin), readlinkSync(markerlessFixture.scraplingBin));
  const markerlessApply = await applyExternalUpdates('2.4.0', {
    component: 'scrapling'
  }, markerlessFixture.dependencies());
  assert.equal(markerlessApply.success, false);
  assert.match(markerlessApply.receipts[0].error, /ownership marker/);
  assert.equal(
    resolve(dirname(markerlessFixture.scraplingBin), readlinkSync(markerlessFixture.scraplingBin)),
    markerlessTarget
  );

  const lockedFixture = createFixture();
  mkdirSync(lockedFixture.stateDir, { recursive: true });
  writeFileSync(join(lockedFixture.stateDir, 'external-update.lock'), 'existing lock\n');
  await assert.rejects(
    applyExternalUpdates('2.4.0', { component: 'yam' }, lockedFixture.dependencies()),
    /another external update may be running/
  );
  assert.equal(readFile(join(lockedFixture.stateDir, 'external-update.lock')), 'existing lock\n');

  const allReceiptFailureFixture = createFixture({
    scraplingVersion: '0.4.12',
    scraplingLatest: '0.4.12',
    insaneLatest: '0.8.2',
    yamLatest: '2.4.0'
  });
  const blockedReceiptDir = join(allReceiptFailureFixture.root, 'blocked-receipts');
  writeFileSync(blockedReceiptDir, 'not a directory\n');
  const allReceiptFailure = await applyExternalUpdates('2.4.0', { all: true }, allReceiptFailureFixture.dependencies({
    receiptDir: blockedReceiptDir
  }));
  assert.equal(allReceiptFailure.success, false);
  assert.deepEqual(allReceiptFailure.applied_components, ['scrapling']);
  assert.equal(allReceiptFailure.receipts[0].persistence, 'failed');
  assert.equal(allReceiptFailureFixture.commands.some((item) => item.command === 'npm'), false);
  assert.equal(allReceiptFailureFixture.commands.some((item) => item.command === 'codex'), false);

  const allFixture = createFixture({
    scraplingVersion: '0.4.12',
    scraplingLatest: '0.4.12',
    insaneLatest: '0.8.2',
    yamLatest: '2.5.0'
  });
  const allApply = await applyExternalUpdates('2.4.0', { all: true }, allFixture.dependencies());
  assert.equal(allApply.success, true);
  assert.deepEqual(allApply.applied_components, ['scrapling', 'insane-search', 'yam']);
  assert.deepEqual(allApply.receipts.map((item) => item.outcome), ['up_to_date', 'up_to_date', 'updated']);
  assert.equal(allApply.receipts[2].source_revision.kind, 'npm_registry_release');
  assert.equal(allFixture.commands.some((item) => item.command === 'npm' && item.args.join(' ') === 'install -g yam-flow@2.5.0'), true);

  const cli = join(process.cwd(), 'dist', 'bin', 'yam.js');
  const help = execFileSync(process.execPath, [cli, 'update', '--help'], { encoding: 'utf8' });
  assert.match(help, /yam update check \[--json\]/);
  assert.match(help, /manual component|explicit component|requires an explicit component/i);
  assert.throws(
    () => execFileSync(process.execPath, [cli, 'update', 'apply', '--all', '--component', 'yam', '--json'], {
      encoding: 'utf8',
      stdio: 'pipe'
    }),
    (error) => error.status === 1 && /choose exactly one/.test(String(error.stderr))
  );

  console.log('external update smoke: ok');
} finally {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
}

function createFixture(options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'yam-external-updates-'));
  roots.push(root);
  const home = join(root, 'home');
  const scraplingRoot = join(home, '.local', 'share', 'scrapling');
  const scraplingBin = join(home, '.homebrew', 'bin', 'scrapling');
  const stateDir = join(root, 'state');
  const receiptDir = join(stateDir, 'receipts');
  const marketplaceRoot = join(home, '.codex', '.tmp', 'marketplaces', 'gptaku-codex');
  const scraplingVersion = options.scraplingVersion || '0.4.11';
  const oldEnvironment = join(scraplingRoot, scraplingVersion);
  const oldExecutable = join(oldEnvironment, 'bin', 'scrapling');
  mkdirSync(dirname(oldExecutable), { recursive: true });
  mkdirSync(dirname(scraplingBin), { recursive: true });
  mkdirSync(marketplaceRoot, { recursive: true });
  writeFileSync(oldExecutable, '#!/bin/sh\n');
  writeFileSync(join(oldEnvironment, '.yam-scrapling-install.json'), `${JSON.stringify({
    schema: 'yam.scrapling-install.v1',
    version: scraplingVersion,
    created_at: '2026-07-27T01:00:00.000Z',
    executable: oldExecutable
  }, null, 2)}\n`);
  symlinkSync(oldExecutable, scraplingBin);

  const fixture = {
    root,
    home,
    scraplingRoot,
    scraplingBin,
    stateDir,
    receiptDir,
    marketplaceRoot,
    oldEnvironment,
    commands: [],
    fetches: [],
    installedInsane: '0.8.2',
    addFails: false,
    venvFails: false,
    marketplaceUpgraded: false,
    pluginListFailsAfterUpgrade: false,
    marketplaceSource: 'https://github.com/fivetaku/gptaku-plugins-codex.git',
    scraplingLatest: options.scraplingLatest || '0.4.12',
    insaneLatest: options.insaneLatest || '0.9.0',
    yamLatest: options.yamLatest || '2.5.0',
    dependencies(pathOverrides = {}) {
      return {
        homeDir: home,
        now: () => new Date('2026-07-27T02:00:00.000Z'),
        env: {
          PATH: process.env.PATH,
          YAM_SCRAPLING_PYTHON: 'python3'
        },
        paths: {
          stateDir,
          receiptDir,
          lockFile: join(stateDir, 'external-update.lock'),
          scraplingRoot,
          scraplingBin,
          ...pathOverrides
        },
        fetchJson: async (url) => {
          fixture.fetches.push(url);
          if (url.includes('registry.npmjs.org')) return { version: fixture.yamLatest };
          if (url.includes('pypi.org')) return { info: { version: fixture.scraplingLatest } };
          if (url.includes('raw.githubusercontent.com')) return { version: fixture.insaneLatest };
          throw new Error(`unexpected fixture URL: ${url}`);
        },
        run: async (command, args) => fixture.run(command, args)
      };
    },
    async run(command, args) {
      fixture.commands.push({ command, args: [...args] });
      if (command === 'git' && args[0] === 'ls-remote') {
        return ok('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\tHEAD\n');
      }
      if (command === 'git' && args[0] === '-C') {
        return ok('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n');
      }
      if (command === 'codex' && args.join(' ') === 'plugin marketplace list --json') {
        return ok(JSON.stringify({
          marketplaces: [{
            name: 'gptaku-codex',
            root: marketplaceRoot,
            marketplaceSource: {
              sourceType: 'git',
              source: fixture.marketplaceSource
            }
          }]
        }));
      }
      if (command === 'codex' && args.join(' ') === 'plugin list --json') {
        if (fixture.pluginListFailsAfterUpgrade && fixture.marketplaceUpgraded) {
          return fail('plugin state unavailable\n');
        }
        return ok(JSON.stringify({
          installed: [{
            pluginId: 'insane-search-codex@gptaku-codex',
            version: fixture.installedInsane
          }]
        }));
      }
      if (command === 'codex' && args.join(' ') === 'plugin marketplace upgrade gptaku-codex --json') {
        fixture.marketplaceUpgraded = true;
        return ok('{"upgraded":true}\n');
      }
      if (command === 'codex' && args.join(' ') === 'plugin add insane-search-codex@gptaku-codex --json') {
        if (fixture.addFails) return fail('already installed; token=fixture-secret; no safe in-place update\n');
        fixture.installedInsane = fixture.insaneLatest;
        return ok('{"installed":true}\n');
      }
      if (command === 'npm' && args[0] === 'install' && args[1] === '-g') {
        return ok('installed\n');
      }
      if (command === 'yam' && args[0] === 'version') return ok(`${fixture.yamLatest}\n`);
      if (command === 'yam') return ok('ok\n');
      if (command === 'python3' && args[0] === '-m' && args[1] === 'venv') {
        const candidate = args[2];
        mkdirSync(join(candidate, 'bin'), { recursive: true });
        writeFileSync(join(candidate, 'bin', 'python'), '#!/bin/sh\n');
        writeFileSync(join(candidate, 'bin', 'scrapling'), '#!/bin/sh\n');
        if (fixture.venvFails) return fail('venv creation failed after partial output\n');
        return ok('venv created\n');
      }
      if (command.endsWith('/bin/python') && args[0] === '-m' && args[1] === 'pip') {
        return ok('pip ok\n');
      }
      if (command === fixture.scraplingBin || command.endsWith('/bin/scrapling')) {
        if (args[0] === '--version') {
          let target = command;
          if (command === fixture.scraplingBin) {
            try {
              target = resolve(dirname(command), readlinkSync(command));
            } catch {
              target = command;
            }
          }
          const version = target.match(/(\d+\.\d+\.\d+)/)?.[1] || scraplingVersion;
          return ok(`Scrapling, version ${version}\n`);
        }
        if (args[0] === 'install') return ok('browsers installed\n');
        if (args[0] === 'extract') {
          const output = args[3];
          mkdirSync(dirname(output), { recursive: true });
          writeFileSync(output, 'Example Domain\n');
          return ok('fetched\n');
        }
      }
      return fail(`unexpected fixture command: ${command} ${args.join(' ')}\n`);
    }
  };
  return fixture;
}

function ok(stdout = '') {
  return { ok: true, status: 0, stdout, stderr: '' };
}

function fail(stderr = '') {
  return { ok: false, status: 1, stdout: '', stderr };
}

function readFile(file) {
  return readFileSync(file, 'utf8');
}
