import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { studyNoteTurnScope } from '../dist/lib/study-note-scope.js';

const dir = mkdtempSync(join(tmpdir(), 'yam-study-turn-'));
const bin = join(process.cwd(), 'dist/bin/yam.js');
const session_id = dir;
const stateDir = join(tmpdir(), `yam-study-note-${process.getuid?.() ?? 'user'}`);
const stateFile = join(stateDir, createHash('sha256').update(realpathSync(dir) + '\0' + session_id).digest('hex') + '.json');
const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
const hook = (event, extra = {}) => JSON.parse(execFileSync(process.execPath, [bin, 'hook', 'run', 'study-note'], {
  input: JSON.stringify({ cwd: dir, session_id, turn_id: '1', hook_event_name: event, ...extra }), encoding: 'utf8'
}));
const scope = () => studyNoteTurnScope({ session_id, turn_id: '1' }, dir);
try {
  git('init', '-q');
  writeFileSync(join(dir, 'app.ts'), 'baseline');
  git('add', '.');
  git('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'baseline');
  writeFileSync(join(dir, 'app.ts'), 'old dirty');
  hook('UserPromptSubmit', { prompt: '$deep review only' });
  assert.deepEqual(scope().files, []);
  assert.equal(scope().mode, 'advisory');
  assert.equal(hook('Stop', { last_assistant_message: 'Review done.' }).systemMessage, undefined);
  writeFileSync(join(dir, 'app.ts'), 'new dirty');
  assert.deepEqual(scope().files, ['app.ts']);
  assert.equal(hook('Stop', { last_assistant_message: 'Done.' }).continue, true);
  const compact = '**Study Note**\napp.ts 역할 변경을 설명합니다. 검증: fixture 확인. 한계: 실제 앱 미확인.\n**Next step**\n남은 작업 없음.';
  assert.equal(hook('Stop', { last_assistant_message: compact }).systemMessage, undefined);
  hook('UserPromptSubmit', { prompt: 'commit reviewed changes' });
  mkdirSync(join(dir, '.yam/mission'), { recursive: true });
  writeFileSync(join(dir, '.yam/mission/reviewer.log'), 'generated');
  writeFileSync(join(dir, '.yam/mission/large.log'), Buffer.alloc(3 * 1024 * 1024));
  assert.deepEqual(scope().files, []);
  rmSync(join(dir, '.yam/mission/large.log'));
  writeFileSync(join(dir, 'app.ts'), 'strict dirty');
  const strict = hook('Stop', { last_assistant_message: 'Done.' });
  assert.equal(strict.decision, 'block');
  assert.match(strict.reason, /missing fields: study_note_present/);
  assert.equal(hook('Stop', { stop_hook_active: true }).continue, true);
  writeFileSync(join(dir, '.yam/study-note.json'), JSON.stringify({ include: ['.yam/mission/**'], exclude: ['.yam/**'] }));
  hook('UserPromptSubmit', { prompt: 'ordinary change' });
  writeFileSync(join(dir, '.yam/mission/reviewer.log'), 'include wins');
  assert.deepEqual(scope().files, ['.yam/mission/reviewer.log']);
  assert.equal(studyNoteTurnScope({ session_id, turn_id: 'other' }, dir).available, false);
  assert.equal(studyNoteTurnScope({}, dir).available, false);
  // Stage and commit must not hide edits made after the baseline.
  hook('UserPromptSubmit');
  writeFileSync(join(dir, 'app.ts'), 'staged change');
  git('add', 'app.ts');
  git('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'changed');
  assert(scope().files.includes('app.ts'));
  hook('UserPromptSubmit');
  git('mv', 'app.ts', 'renamed.ts');
  assert(scope().files.includes('app.ts') && scope().files.includes('renamed.ts'));
  hook('UserPromptSubmit');
  rmSync(join(dir, 'renamed.ts'));
  assert(scope().files.includes('renamed.ts'));
  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  assert(!readFileSync(stateFile, 'utf8').includes('staged change'));
  writeFileSync(stateFile, JSON.stringify({ ...state, created: 0 }));
  assert.equal(scope().available, false);
  writeFileSync(stateFile, '{invalid');
  assert.equal(scope().available, false);
  rmSync(stateFile);
  symlinkSync(join(dir, 'protected.txt'), stateFile);
  writeFileSync(join(dir, 'protected.txt'), 'preserve');
  assert.equal(studyNoteTurnScope({ session_id }, dir, true).available, false);
  assert.equal(readFileSync(join(dir, 'protected.txt'), 'utf8'), 'preserve');
  console.log('study-note-turn-smoke: ok (dirty re-edit, advisory/strict, generated/include, commit/rename/delete, missing/stale/corrupt baseline, symlink safety)');
} finally {
  rmSync(stateFile, { force: true });
  rmSync(dir, { recursive: true, force: true });
}
assert(!existsSync(dir) && !existsSync(stateFile));
