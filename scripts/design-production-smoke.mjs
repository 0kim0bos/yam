#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import {
  addPlanReviewComment,
  closePlanReviewCanvas,
  createDesignRevisionState as createDesignRevisionStateRaw,
  createPlanReviewCanvas as createPlanReviewCanvasRaw,
  finalizeDesignProductionPhase,
  readDesignRevisionState,
  recordDesignRevisionRound,
  verifyDesignProductionPhaseReceipt,
  verifyFinalGalleryManifest,
  writeFinalGalleryManifest
} from '../dist/lib/design-production.js';

const roots = [];
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+Xw2+WQAAAABJRU5ErkJggg==', 'base64');
const repeatedDemand = {
  kind: 'repeated_plan_review',
  evidence: 'Repeated exact-element plan feedback requires one bounded local review phase.'
};
const createPlanReviewCanvas = (input) => createPlanReviewCanvasRaw({ demand_trigger: repeatedDemand, ...input });
const revisionCommentIds = [
  'missing-comment', 'protected-comment', 'not-editable-comment', 'unlinked-comment', 'tampered-comment',
  'hash-comment', 'ambiguous-comment', 'bounded-finding', 'reuse-comment', 'accepted-comment'
];
const createDesignRevisionState = async (input) => {
  const reviewPlan = join(input.root, 'plans', `revision-${input.session_id}.md`);
  write(reviewPlan, '# Revision state review\nReview the revision state boundary.\n');
  const canvas = await createPlanReviewCanvas({
    root: input.root,
    session_id: input.session_id,
    title: `Revision state ${input.session_id}`,
    artifacts: [{ id: 'revision-plan', role: 'plan', file_path: rel(input.root, reviewPlan) }]
  });
  for (const commentId of revisionCommentIds) {
    await addPlanReviewComment({
      root: input.root,
      session_path: rel(input.root, canvas.session_path),
      render_path: rel(input.root, canvas.render_path),
      comment: {
        id: commentId,
        anchor: { artifact_id: 'revision-plan', kind: 'line', locator: 'L2' },
        finding: `Bound revision finding ${commentId}.`,
        requested_change: 'Record only a Canvas-linked, fresh, bounded revision.'
      }
    });
  }
  await closePlanReviewCanvas({
    root: input.root,
    session_path: rel(input.root, canvas.session_path),
    render_path: rel(input.root, canvas.render_path),
    verdict: 'request_changes'
  });
  const storedCanvas = JSON.parse(readFileSync(canvas.session_path, 'utf8'));
  storedCanvas.created_at = '2000-01-01T00:00:00.000Z';
  storedCanvas.demand_trigger.recorded_at = storedCanvas.created_at;
  storedCanvas.updated_at = '2000-01-01T00:00:01.000Z';
  storedCanvas.closed_at = storedCanvas.updated_at;
  writeJson(canvas.session_path, storedCanvas);
  return createDesignRevisionStateRaw(input);
};

try {
  const root = fixtureRoot();
  const plan = join(root, 'plans', 'home.md');
  write(plan, '# Home plan\nUse one primary action.\n');
  await assert.rejects(() => createPlanReviewCanvasRaw({
    root,
    session_id: 'missing-demand',
    title: 'Missing demand',
    artifacts: [{ id: 'missing-demand-plan', role: 'plan', file_path: rel(root, plan) }]
  }), /demand_trigger/);
  await assert.rejects(() => createPlanReviewCanvas({
    root,
    session_id: '..',
    title: 'Dot segment session',
    artifacts: [{ id: 'dot-plan', role: 'plan', file_path: rel(root, plan) }]
  }), /dot path segment/);
  const canvas = await createPlanReviewCanvas({
    root,
    session_id: 'home-review',
    title: '<script>alert("no")</script> Home review',
    artifacts: [{ id: 'home-plan', role: 'plan', file_path: rel(root, plan) }]
  });
  assert.equal(canvas.truth_status, 'partial');
  assert.equal(canvas.session.execution_boundary.remote_sharing, false);
  assert.equal(canvas.session.execution_boundary.server, false);
  const html = readFileSync(canvas.render_path, 'utf8');
  assert.match(html, /Content-Security-Policy/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);

  await addPlanReviewComment({
    root,
    session_path: rel(root, canvas.session_path),
    render_path: rel(root, canvas.render_path),
    comment: {
      id: 'cta-finding',
      anchor: { artifact_id: 'home-plan', kind: 'line', locator: 'L2' },
      finding: 'The primary action has no concrete label.',
      requested_change: 'Name the action using the destination outcome.'
    }
  });
  assert.match(readFileSync(canvas.render_path, 'utf8'), /L2: Use one primary action/);
  const closed = await closePlanReviewCanvas({
    root,
    session_path: rel(root, canvas.session_path),
    render_path: rel(root, canvas.render_path),
    verdict: 'request_changes'
  });
  assert.equal(closed.session.status, 'closed');
  assert.equal(closed.session.verdict, 'request_changes');
  assert.equal(closed.truth_status, 'verified');
  await assert.rejects(() => addPlanReviewComment({
    root,
    session_path: rel(root, canvas.session_path),
    render_path: rel(root, canvas.render_path),
    comment: {
      id: 'late',
      anchor: { artifact_id: 'home-plan', kind: 'line', locator: 'L1' },
      finding: 'This comment is intentionally too late.',
      requested_change: 'Do not append comments after explicit close.'
    }
  }), /closed/);

  const unrelated = join(root, 'unrelated.md');
  write(unrelated, 'must remain unchanged\n');
  const pathBoundCanvas = await createPlanReviewCanvas({
    root,
    session_id: 'path-bound',
    title: 'Fixed evidence paths',
    artifacts: [{ id: 'path-plan', role: 'plan', file_path: rel(root, plan) }]
  });
  await assert.rejects(() => addPlanReviewComment({
    root,
    session_path: rel(root, pathBoundCanvas.session_path),
    render_path: rel(root, unrelated),
    comment: {
      id: 'wrong-render-target',
      anchor: { artifact_id: 'path-plan', kind: 'line', locator: 'L1' },
      finding: 'The render target points at an unrelated project file.',
      requested_change: 'Reject it without writing any bytes.'
    }
  }), /cannot target unrelated project files/);
  assert.equal(readFileSync(unrelated, 'utf8'), 'must remain unchanged\n');
  await assert.rejects(() => createPlanReviewCanvas({
    root,
    session_id: 'custom-render',
    title: 'Reject custom render path',
    artifacts: [{ id: 'custom-plan', role: 'plan', file_path: rel(root, plan) }],
    render_path: 'unrelated.md'
  }), /render_path is fixed/);

  await assert.rejects(() => createPlanReviewCanvas({
    root,
    session_id: 'escape',
    title: 'Traversal attempt',
    artifacts: [{ id: 'bad', role: 'plan', file_path: '../outside.md' }]
  }), /escapes the project root/);

  const outside = fixtureRoot();
  write(join(outside, 'secret.md'), 'secret\n');
  symlinkSync(outside, join(root, 'escape-link'));
  await assert.rejects(() => createPlanReviewCanvas({
    root,
    session_id: 'symlink-escape',
    title: 'Symlink traversal attempt',
    artifacts: [{ id: 'bad', role: 'plan', file_path: 'escape-link/secret.md' }]
  }), /escapes the project root/);

  await assert.rejects(() => createPlanReviewCanvas({
    root,
    session_id: 'duplicates',
    title: 'Duplicate ids',
    artifacts: [
      { id: 'same', role: 'plan', file_path: rel(root, plan) },
      { id: 'same', role: 'reference', file_path: rel(root, plan) }
    ]
  }), /duplicate artifact id/);

  const invalidAnchor = await createPlanReviewCanvas({
    root,
    session_id: 'invalid-anchor',
    title: 'Anchor validation',
    artifacts: [{ id: 'anchor-plan', role: 'plan', file_path: rel(root, plan) }]
  });
  await assert.rejects(() => addPlanReviewComment({
    root,
    session_path: rel(root, invalidAnchor.session_path),
    render_path: rel(root, invalidAnchor.render_path),
    comment: {
      id: 'bad-line',
      anchor: { artifact_id: 'anchor-plan', kind: 'line', locator: 'L999' },
      finding: 'This finding points outside the actual plan.',
      requested_change: 'Reject line anchors that do not exist.'
    }
  }), /outside the artifact line range/);
  await assert.rejects(() => addPlanReviewComment({
    root,
    session_path: rel(root, invalidAnchor.session_path),
    render_path: rel(root, invalidAnchor.render_path),
    comment: {
      id: 'bad-text',
      anchor: { artifact_id: 'anchor-plan', kind: 'text', locator: 'text that is absent' },
      finding: 'This finding points to text that is absent.',
      requested_change: 'Reject text anchors that cannot be found.'
    }
  }), /was not found/);

  const repeatedPlan = join(root, 'plans', 'repeated.md');
  write(repeatedPlan, '# Repeated\nRepeated target.\nMiddle.\nRepeated target.\n');
  const ambiguousAnchor = await createPlanReviewCanvas({
    root,
    session_id: 'ambiguous-anchor',
    title: 'Ambiguous anchor validation',
    artifacts: [{ id: 'repeated-plan', role: 'plan', file_path: rel(root, repeatedPlan) }]
  });
  await assert.rejects(() => addPlanReviewComment({
    root,
    session_path: rel(root, ambiguousAnchor.session_path),
    render_path: rel(root, ambiguousAnchor.render_path),
    comment: {
      id: 'ambiguous-text',
      anchor: { artifact_id: 'repeated-plan', kind: 'text', locator: 'Repeated target.' },
      finding: 'The same text appears at more than one exact location.',
      requested_change: 'Use a unique excerpt or exact line anchor.'
    }
  }), /ambiguous/);

  const tamperedAnchor = await createPlanReviewCanvas({
    root,
    session_id: 'tampered-anchor',
    title: 'Stored anchor integrity',
    artifacts: [{ id: 'tampered-anchor-plan', role: 'plan', file_path: rel(root, plan) }]
  });
  await addPlanReviewComment({
    root,
    session_path: rel(root, tamperedAnchor.session_path),
    render_path: rel(root, tamperedAnchor.render_path),
    comment: {
      id: 'stored-anchor',
      anchor: { artifact_id: 'tampered-anchor-plan', kind: 'line', locator: 'L2' },
      finding: 'The stored anchor must remain bound to its captured context.',
      requested_change: 'Reject mutated locators before close.'
    }
  });
  const tamperedSession = JSON.parse(readFileSync(tamperedAnchor.session_path, 'utf8'));
  tamperedSession.comments[0].anchor.locator = 'L1';
  writeJson(tamperedAnchor.session_path, tamperedSession);
  await assert.rejects(() => closePlanReviewCanvas({
    root,
    session_path: rel(root, tamperedAnchor.session_path),
    render_path: rel(root, tamperedAnchor.render_path),
    verdict: 'request_changes'
  }), /anchor context changed/);

  const tamperedCanvas = await createPlanReviewCanvas({
    root,
    session_id: 'tampered-plan',
    title: 'Tampered plan',
    artifacts: [{ id: 'tamper-plan', role: 'plan', file_path: rel(root, plan) }]
  });
  write(plan, '# Changed after session creation\n');
  await assert.rejects(() => closePlanReviewCanvas({
    root,
    session_path: rel(root, tamperedCanvas.session_path),
    render_path: rel(root, tamperedCanvas.render_path),
    verdict: 'approve'
  }), /sha256 changed/);
  write(plan, '# Home plan\nUse one primary action.\n');

  const artifact = join(root, 'artifacts', 'hero.png');
  write(artifact, png);
  const digest = sha256(png);
  const revisionDir = join(root, '.yam', 'ueye', 'revisions');
  const archived = join(revisionDir, 'r1', 'hero.png');
  const archivedRound2 = join(revisionDir, 'r2', 'hero.png');
  write(archived, png);
  write(archivedRound2, png);
  const revisionManifest = join(revisionDir, 'manifest.json');
  const revisionEntry = {
    artifact_id: 'hero',
    round: 1,
    source_path: artifact,
    archived_path: 'r1/hero.png',
    archived_at: new Date().toISOString(),
    sha256: digest,
    bytes: png.length,
    dimensions: '1x1'
  };
  const revisionEntryRound2 = {
    ...revisionEntry,
    round: 2,
    archived_path: 'r2/hero.png',
    archived_at: new Date().toISOString()
  };
  writeJson(revisionManifest, {
    schema: 'yam.ueye-revision-history.v1',
    updated_at: new Date().toISOString(),
    revisions: [revisionEntry, revisionEntryRound2]
  });
  const assetManifest = join(root, '.yam', 'ueye', 'assets.json');
  writeJson(assetManifest, {
    schema: 'yam.ueye-asset-manifest.v1',
    updated_at: new Date().toISOString(),
    assets: [{ id: 'official-hero', file_path: relative(dirname(assetManifest), artifact), sha256: digest, do_not_replace: true, allowed_for_edit: false }]
  });
  const baseRef = {
    artifact_id: 'hero',
    manifest_path: rel(root, revisionManifest),
    round: 1,
    sha256: digest,
    archived_at: revisionEntry.archived_at,
    intent: 'preserve',
    asset_manifest_path: rel(root, assetManifest),
    asset_id: 'official-hero'
  };
  const baseRefRound2 = { ...baseRef, round: 2, archived_at: revisionEntryRound2.archived_at };

  const missingFindingState = await createDesignRevisionState({ root, session_id: 'missing-finding' });
  await assert.rejects(() => recordDesignRevisionRound({
    root,
    state_path: rel(root, missingFindingState.state_path),
    reviewer_finding: { id: 'missing', source_comment_id: 'missing-comment', summary: '', evidence: '' },
    planned_change: 'Apply a focused CTA correction.',
    outcome: 'changes_requested',
    revision_refs: [baseRef]
  }), /reviewer_finding.summary/);

  const protectedState = await createDesignRevisionState({ root, session_id: 'protected' });
  await assert.rejects(() => recordDesignRevisionRound({
    root,
    state_path: rel(root, protectedState.state_path),
    reviewer_finding: { id: 'protected', source_comment_id: 'protected-comment', summary: 'The protected hero needs a derived treatment.', evidence: 'The asset manifest marks official-hero do_not_replace.' },
    planned_change: 'Create an editable copy while preserving the archived source.',
    outcome: 'changes_requested',
    revision_refs: [{ ...baseRef, intent: 'edit_copy' }]
  }), /protected Ueye asset/);
  assert.equal((await readDesignRevisionState(protectedState.state_path)).status, 'integrity_blocked');

  const notEditableManifest = join(root, '.yam', 'ueye', 'not-editable-assets.json');
  writeJson(notEditableManifest, {
    schema: 'yam.ueye-asset-manifest.v1',
    updated_at: new Date().toISOString(),
    assets: [{ id: 'not-editable-hero', file_path: relative(dirname(notEditableManifest), artifact), sha256: digest, do_not_replace: false, allowed_for_edit: false }]
  });
  const notEditableState = await createDesignRevisionState({ root, session_id: 'not-editable' });
  await assert.rejects(() => recordDesignRevisionRound({
    root,
    state_path: rel(root, notEditableState.state_path),
    reviewer_finding: { id: 'not-editable', source_comment_id: 'not-editable-comment', summary: 'The source is not explicitly approved for editing.', evidence: 'The asset manifest has allowed_for_edit false.' },
    planned_change: 'Stop until edit permission is recorded explicitly.',
    outcome: 'changes_requested',
    revision_refs: [{ ...baseRef, intent: 'edit_copy', asset_manifest_path: rel(root, notEditableManifest), asset_id: 'not-editable-hero' }]
  }), /not explicitly allowed_for_edit/);

  const unlinkedEditState = await createDesignRevisionState({ root, session_id: 'unlinked-edit' });
  await assert.rejects(() => recordDesignRevisionRound({
    root,
    state_path: rel(root, unlinkedEditState.state_path),
    reviewer_finding: { id: 'unlinked-edit', source_comment_id: 'unlinked-comment', summary: 'Editable intent lacks source protection metadata.', evidence: 'The revision reference deliberately omits the Ueye asset manifest.' },
    planned_change: 'Stop until the source asset is registered and proven editable.',
    outcome: 'changes_requested',
    revision_refs: [{ ...baseRef, intent: 'edit_copy', asset_manifest_path: null, asset_id: null }]
  }), /edit_copy requires an asset manifest/);

  const tamperedProtectedState = await createDesignRevisionState({ root, session_id: 'tampered-protected' });
  write(artifact, Buffer.from('tampered protected asset'));
  await assert.rejects(() => recordDesignRevisionRound({
    root,
    state_path: rel(root, tamperedProtectedState.state_path),
    reviewer_finding: { id: 'tampered-protected', source_comment_id: 'tampered-comment', summary: 'The protected asset no longer matches its recorded digest.', evidence: 'The current asset bytes differ from the Ueye asset manifest.' },
    planned_change: 'Stop without editing or packaging the protected asset.',
    outcome: 'changes_requested',
    revision_refs: [baseRef]
  }), /content changed/);
  write(artifact, png);

  const hashState = await createDesignRevisionState({ root, session_id: 'hash-blocked' });
  await assert.rejects(() => recordDesignRevisionRound({
    root,
    state_path: rel(root, hashState.state_path),
    reviewer_finding: { id: 'hash', source_comment_id: 'hash-comment', summary: 'The revision evidence must match its archived digest.', evidence: 'The supplied digest is deliberately invalid.' },
    planned_change: 'Stop before any artifact edit occurs.',
    outcome: 'changes_requested',
    revision_refs: [{ ...baseRef, sha256: '0'.repeat(64) }]
  }), /sha256 mismatch/);
  assert.equal((await readDesignRevisionState(hashState.state_path)).status, 'integrity_blocked');

  const ambiguousState = await createDesignRevisionState({ root, session_id: 'ambiguous' });
  writeJson(revisionManifest, {
    schema: 'yam.ueye-revision-history.v1',
    updated_at: new Date().toISOString(),
    revisions: [revisionEntry, revisionEntry, revisionEntryRound2]
  });
  await assert.rejects(() => recordDesignRevisionRound({
    root,
    state_path: rel(root, ambiguousState.state_path),
    reviewer_finding: { id: 'ambiguous', source_comment_id: 'ambiguous-comment', summary: 'The revision reference resolves to multiple entries.', evidence: 'Two manifest entries share the same artifact id and round.' },
    planned_change: 'Repair the manifest before planning another edit.',
    outcome: 'changes_requested',
    revision_refs: [baseRef]
  }), /ambiguous/);
  writeJson(revisionManifest, {
    schema: 'yam.ueye-revision-history.v1',
    updated_at: new Date().toISOString(),
    revisions: [revisionEntry, revisionEntryRound2]
  });

  const bounded = await createDesignRevisionState({ root, session_id: 'bounded-limit' });
  await assert.rejects(() => createDesignRevisionStateRaw({
    root,
    session_id: 'bounded-limit',
    state_path: '.yam/ueye/design-production/bounded-limit/alternate-state.json'
  }), /state_path is fixed/);
  await assert.rejects(() => createDesignRevisionStateRaw({ root, session_id: 'bounded-limit' }), /already exists/);
  const first = await recordDesignRevisionRound({
    root,
    state_path: rel(root, bounded.state_path),
    reviewer_finding: { id: 'round-1', source_comment_id: 'bounded-finding', summary: 'The CTA label does not describe the destination.', evidence: 'Canvas finding bounded-finding anchors the issue to plans/home.md.' },
    planned_change: 'Replace the generic CTA with an outcome-oriented label.',
    outcome: 'changes_requested',
    revision_refs: [baseRef]
  });
  assert.equal(first.state.status, 'active');
  revisionEntryRound2.archived_at = first.round.recorded_at;
  baseRefRound2.archived_at = revisionEntryRound2.archived_at;
  writeJson(revisionManifest, {
    schema: 'yam.ueye-revision-history.v1',
    updated_at: new Date().toISOString(),
    revisions: [revisionEntry, revisionEntryRound2]
  });
  const second = await recordDesignRevisionRound({
    root,
    state_path: rel(root, bounded.state_path),
    reviewer_finding: { id: 'round-2', source_comment_id: 'bounded-finding', summary: 'The revised CTA is clear but lacks focus styling.', evidence: 'Keyboard inspection shows no visible focus indicator.' },
    planned_change: 'Add a high-contrast focus-visible treatment only.',
    outcome: 'changes_requested',
    revision_refs: [baseRefRound2]
  });
  assert.equal(second.state.status, 'two_round_limit');

  const reusedRevision = await createDesignRevisionState({ root, session_id: 'reused-revision' });
  await recordDesignRevisionRound({
    root,
    state_path: rel(root, reusedRevision.state_path),
    reviewer_finding: { id: 'reuse-round-1', source_comment_id: 'reuse-comment', summary: 'The first focused change has a preserved source.', evidence: 'Round one points to the first Ueye archive.' },
    planned_change: 'Apply the first bounded change.',
    outcome: 'changes_requested',
    revision_refs: [baseRef]
  });
  await assert.rejects(() => recordDesignRevisionRound({
    root,
    state_path: rel(root, reusedRevision.state_path),
    reviewer_finding: { id: 'reuse-round-2', source_comment_id: 'reuse-comment', summary: 'A second change cannot reuse only the first archive.', evidence: 'No new pre-edit revision was supplied.' },
    planned_change: 'Reject this unproven second change.',
    outcome: 'changes_requested',
    revision_refs: [baseRef]
  }), /newly archived Ueye revision/);
  await assert.rejects(() => recordDesignRevisionRound({
    root,
    state_path: rel(root, bounded.state_path),
    reviewer_finding: { id: 'round-3', source_comment_id: 'bounded-finding', summary: 'A third round must never start.', evidence: 'The state already contains two focused rounds.' },
    planned_change: 'This change must not be recorded.',
    outcome: 'accepted',
    revision_refs: [baseRef]
  }), /stopped with status two_round_limit|maximum is 2/);

  const phaseCanvas = await createPlanReviewCanvas({
    root,
    session_id: 'bounded',
    title: 'Demand-gated bounded review',
    artifacts: [{ id: 'bounded-plan', role: 'plan', file_path: rel(root, plan) }]
  });
  await addPlanReviewComment({
    root,
    session_path: rel(root, phaseCanvas.session_path),
    render_path: rel(root, phaseCanvas.render_path),
    comment: {
      id: 'bounded-finding',
      anchor: { artifact_id: 'bounded-plan', kind: 'text', locator: 'primary action' },
      finding: 'Repeated reviews still disagree on the primary action treatment.',
      requested_change: 'Keep the package draft after the bounded second round.'
    }
  });
  const phaseClosed = await closePlanReviewCanvas({
    root,
    session_path: rel(root, phaseCanvas.session_path),
    render_path: rel(root, phaseCanvas.render_path),
    verdict: 'request_changes'
  });

  const phaseArchivedRound1 = join(revisionDir, 'r3', 'hero.png');
  write(phaseArchivedRound1, png);
  const phaseRevisionEntry1 = {
    ...revisionEntry,
    round: 3,
    archived_path: 'r3/hero.png',
    archived_at: phaseClosed.session.closed_at
  };
  writeJson(revisionManifest, {
    schema: 'yam.ueye-revision-history.v1',
    updated_at: new Date().toISOString(),
    revisions: [revisionEntry, revisionEntryRound2, phaseRevisionEntry1]
  });
  const phaseRef1 = { ...baseRef, round: 3, archived_at: phaseRevisionEntry1.archived_at };
  const phaseState = await createDesignRevisionStateRaw({ root, session_id: 'bounded' });
  const phaseFirstRound = await recordDesignRevisionRound({
    root,
    state_path: rel(root, phaseState.state_path),
    reviewer_finding: { id: 'phase-round-1', source_comment_id: 'bounded-finding', summary: 'The CTA label still lacks an explicit outcome.', evidence: 'Canvas comment bounded-finding identifies the exact plan text.' },
    planned_change: 'Apply the first focused CTA correction.',
    outcome: 'changes_requested',
    revision_refs: [phaseRef1]
  });
  const phaseArchivedRound2 = join(revisionDir, 'r4', 'hero.png');
  write(phaseArchivedRound2, png);
  const phaseRevisionEntry2 = {
    ...revisionEntry,
    round: 4,
    archived_path: 'r4/hero.png',
    archived_at: phaseFirstRound.round.recorded_at
  };
  writeJson(revisionManifest, {
    schema: 'yam.ueye-revision-history.v1',
    updated_at: new Date().toISOString(),
    revisions: [revisionEntry, revisionEntryRound2, phaseRevisionEntry1, phaseRevisionEntry2]
  });
  const phaseRef2 = { ...baseRef, round: 4, archived_at: phaseRevisionEntry2.archived_at };
  const phaseSecondRound = await recordDesignRevisionRound({
    root,
    state_path: rel(root, phaseState.state_path),
    reviewer_finding: { id: 'phase-round-2', source_comment_id: 'bounded-finding', summary: 'The second review still requests one bounded focus treatment.', evidence: 'The same Canvas finding remains the source of the bounded follow-up.' },
    planned_change: 'Apply the second and final focused treatment, then stop.',
    outcome: 'changes_requested',
    revision_refs: [phaseRef2]
  });
  assert.equal(phaseSecondRound.state.status, 'two_round_limit');

  const acceptedState = await createDesignRevisionState({ root, session_id: 'accepted' });
  const accepted = await recordDesignRevisionRound({
    root,
    state_path: rel(root, acceptedState.state_path),
    reviewer_finding: { id: 'accepted-round', source_comment_id: 'accepted-comment', summary: 'The focused CTA correction matches the recorded request.', evidence: 'The reviewer compared the result against the recorded finding and accepted it.' },
    planned_change: 'Preserve the accepted result and stop revising.',
    outcome: 'accepted',
    revision_refs: [baseRef]
  });
  assert.equal(accepted.state.status, 'accepted');
  await assert.rejects(() => recordDesignRevisionRound({
    root,
    state_path: rel(root, acceptedState.state_path),
    reviewer_finding: { id: 'after-accept', source_comment_id: 'accepted-comment', summary: 'No round may run after reviewer acceptance.', evidence: 'The revision state is already accepted.' },
    planned_change: 'This change must not be recorded.',
    outcome: 'changes_requested',
    revision_refs: [baseRef]
  }), /stopped with status accepted/);

  const missingBoundCommentCanvas = await createPlanReviewCanvas({
    root,
    session_id: 'missing-bound-comment',
    title: 'Missing bound comment',
    artifacts: [{ id: 'missing-bound-plan', role: 'plan', file_path: rel(root, plan) }]
  });
  await addPlanReviewComment({
    root,
    session_path: rel(root, missingBoundCommentCanvas.session_path),
    render_path: rel(root, missingBoundCommentCanvas.render_path),
    comment: {
      id: 'only-bound-comment',
      anchor: { artifact_id: 'missing-bound-plan', kind: 'line', locator: 'L2' },
      finding: 'Only this exact Canvas finding may authorize a revision.',
      requested_change: 'Reject revision findings that are absent from this Canvas.'
    }
  });
  await closePlanReviewCanvas({
    root,
    session_path: rel(root, missingBoundCommentCanvas.session_path),
    render_path: rel(root, missingBoundCommentCanvas.render_path),
    verdict: 'request_changes'
  });
  const missingBoundCommentState = await createDesignRevisionStateRaw({ root, session_id: 'missing-bound-comment' });
  await assert.rejects(() => recordDesignRevisionRound({
    root,
    state_path: rel(root, missingBoundCommentState.state_path),
    reviewer_finding: { id: 'unbound-accepted', source_comment_id: 'accepted-comment', summary: 'This accepted finding is absent from the Canvas.', evidence: 'The bound Canvas contains only-bound-comment.' },
    planned_change: 'Do not issue a verified revision receipt.',
    outcome: 'accepted',
    revision_refs: [baseRef]
  }), /not present in the bound Plan Review Canvas/);

  const galleryPath = join(root, '.yam', 'ueye', 'design-production', 'bounded', 'gallery.json');
  const galleryArtifact = {
    id: 'hero-final',
    role: 'primary',
    provenance: { kind: 'operator', source_ref: 'local reviewed source', license_note: 'Operator asserts ownership; not independently verified.' },
    revision_ref: baseRef,
    dimensions: '1x1',
    sha256: digest,
    completion_state: 'ready_for_inspection',
    final_path: rel(root, artifact)
  };
  const gallery = await writeFinalGalleryManifest({
    root,
    manifest_path: rel(root, galleryPath),
    session_id: 'bounded',
    completion_state: 'ready_for_inspection',
    artifacts: [galleryArtifact]
  });
  assert.equal(gallery.manifest.claims.visual_correctness, 'not_verified');
  assert.equal(gallery.manifest.claims.license_correctness, 'not_verified');
  assert.equal(gallery.manifest.claims.implementation_correctness, 'not_verified');
  assert.equal(gallery.truth_status, 'partial');
  const verified = await verifyFinalGalleryManifest({ root, manifest_path: rel(root, galleryPath) });
  assert.equal(verified.ready, true, JSON.stringify(verified));
  assert.equal(verified.truth_status, 'partial');

  const stalePhaseGalleryPath = join(root, '.yam', 'ueye', 'design-production', 'bounded', 'stale-phase-gallery.json');
  await writeFinalGalleryManifest({
    root,
    manifest_path: rel(root, stalePhaseGalleryPath),
    session_id: 'bounded',
    completion_state: 'draft',
    artifacts: [{ ...galleryArtifact, revision_ref: baseRefRound2, completion_state: 'draft' }]
  });
  await assert.rejects(() => finalizeDesignProductionPhase({
    root,
    demand_trigger: repeatedDemand,
    canvas_session_path: rel(root, phaseCanvas.session_path),
    revision_state_path: rel(root, phaseState.state_path),
    gallery_manifest_path: rel(root, stalePhaseGalleryPath),
    receipt_path: '.yam/ueye/design-production/bounded/stale-phase-receipt.json'
  }), /phase review boundary|fresh Ueye archive|not recorded in the final phase revision round/);

  const phaseGalleryPath = join(root, '.yam', 'ueye', 'design-production', 'bounded', 'phase-gallery.json');
  await writeFinalGalleryManifest({
    root,
    manifest_path: rel(root, phaseGalleryPath),
    session_id: 'bounded',
    completion_state: 'draft',
    artifacts: [{ ...galleryArtifact, revision_ref: phaseRef2, completion_state: 'draft' }]
  });
  const staleChronologyGalleryPath = join(root, '.yam', 'ueye', 'design-production', 'bounded', 'stale-chronology-gallery.json');
  await writeFinalGalleryManifest({
    root,
    manifest_path: rel(root, staleChronologyGalleryPath),
    session_id: 'bounded',
    completion_state: 'draft',
    artifacts: [{ ...galleryArtifact, revision_ref: phaseRef2, completion_state: 'draft' }]
  });
  const staleChronologyGallery = JSON.parse(readFileSync(staleChronologyGalleryPath, 'utf8'));
  staleChronologyGallery.created_at = phaseCanvas.session.created_at;
  writeJson(staleChronologyGalleryPath, staleChronologyGallery);
  await assert.rejects(() => finalizeDesignProductionPhase({
    root,
    demand_trigger: repeatedDemand,
    canvas_session_path: rel(root, phaseCanvas.session_path),
    revision_state_path: rel(root, phaseState.state_path),
    gallery_manifest_path: rel(root, staleChronologyGalleryPath),
    receipt_path: '.yam/ueye/design-production/bounded/stale-chronology-receipt.json'
  }), /final gallery was created before the Plan Review Canvas closed/);
  assert.ok(Date.parse(phaseSecondRound.round.recorded_at) > Date.parse(phaseClosed.session.closed_at));
  const staleRevisionGalleryPath = join(root, '.yam', 'ueye', 'design-production', 'bounded', 'stale-revision-gallery.json');
  await writeFinalGalleryManifest({
    root,
    manifest_path: rel(root, staleRevisionGalleryPath),
    session_id: 'bounded',
    completion_state: 'draft',
    artifacts: [{ ...galleryArtifact, revision_ref: phaseRef2, completion_state: 'draft' }]
  });
  const staleRevisionGallery = JSON.parse(readFileSync(staleRevisionGalleryPath, 'utf8'));
  staleRevisionGallery.created_at = phaseClosed.session.closed_at;
  writeJson(staleRevisionGalleryPath, staleRevisionGallery);
  await assert.rejects(() => finalizeDesignProductionPhase({
    root,
    demand_trigger: repeatedDemand,
    canvas_session_path: rel(root, phaseCanvas.session_path),
    revision_state_path: rel(root, phaseState.state_path),
    gallery_manifest_path: rel(root, staleRevisionGalleryPath),
    receipt_path: '.yam/ueye/design-production/bounded/stale-revision-receipt.json'
  }), /final gallery was created before the final revision round was recorded/);
  const alternatePhaseStatePath = join(root, '.yam', 'ueye', 'design-production', 'bounded', 'alternate-revision-state.json');
  writeJson(alternatePhaseStatePath, JSON.parse(readFileSync(phaseState.state_path, 'utf8')));
  await assert.rejects(() => recordDesignRevisionRound({
    root,
    state_path: rel(root, alternatePhaseStatePath),
    reviewer_finding: { id: 'alternate-round', source_comment_id: 'bounded-finding', summary: 'An alternate state file must not reset the round budget.', evidence: 'The canonical state already stopped at two rounds.' },
    planned_change: 'Reject the alternate state before recording any round.',
    outcome: 'accepted',
    revision_refs: [phaseRef2]
  }), /session-derived canonical path/);
  await assert.rejects(() => finalizeDesignProductionPhase({
    root,
    demand_trigger: repeatedDemand,
    canvas_session_path: rel(root, phaseCanvas.session_path),
    revision_state_path: rel(root, alternatePhaseStatePath),
    gallery_manifest_path: rel(root, phaseGalleryPath),
    receipt_path: '.yam/ueye/design-production/bounded/alternate-phase-receipt.json'
  }), /session-derived canonical path/);
  assert.throws(() => execFileSync(join(process.cwd(), 'dist', 'bin', 'yam.js'), [
    'ueye', 'production', 'revision', 'show',
    '--root', root,
    '--state-path', rel(root, alternatePhaseStatePath),
    '--json'
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }), (error) => /session-derived canonical path/.test(String(error.stdout)));
  const phaseReceipt = await finalizeDesignProductionPhase({
    root,
    demand_trigger: repeatedDemand,
    canvas_session_path: rel(root, phaseCanvas.session_path),
    revision_state_path: rel(root, phaseState.state_path),
    gallery_manifest_path: rel(root, phaseGalleryPath),
    receipt_path: '.yam/ueye/design-production/bounded/phase-receipt.json'
  });
  assert.equal(phaseReceipt.truth_status, 'partial');
  assert.equal(phaseReceipt.revision.status, 'two_round_limit');
  assert.equal(phaseReceipt.gallery.claims.implementation_correctness, 'not_verified');
  assert.match(phaseReceipt.receipt_digest, /^sha256:[a-f0-9]{64}$/);
  const phaseVerification = await verifyDesignProductionPhaseReceipt({
    root,
    receipt_path: rel(root, phaseReceipt.receipt_path)
  });
  assert.equal(phaseVerification.ready, true, JSON.stringify(phaseVerification));

  const forgedStaleGalleryReceipt = JSON.parse(readFileSync(phaseReceipt.receipt_path, 'utf8'));
  forgedStaleGalleryReceipt.gallery.path = rel(root, staleChronologyGalleryPath);
  forgedStaleGalleryReceipt.upstream_digests.gallery_manifest = `sha256:${sha256(readFileSync(staleChronologyGalleryPath))}`;
  forgedStaleGalleryReceipt.receipt_digest = receiptDigest(forgedStaleGalleryReceipt);
  const forgedStaleGalleryReceiptPath = join(root, '.yam', 'ueye', 'design-production', 'bounded', 'forged-stale-gallery-receipt.json');
  writeJson(forgedStaleGalleryReceiptPath, forgedStaleGalleryReceipt);
  const forgedStaleGalleryVerification = await verifyDesignProductionPhaseReceipt({
    root,
    receipt_path: rel(root, forgedStaleGalleryReceiptPath)
  });
  assert.equal(forgedStaleGalleryVerification.ready, false, JSON.stringify(forgedStaleGalleryVerification));
  assert.match(forgedStaleGalleryVerification.errors.join(' '), /gallery chronology.*created before the Plan Review Canvas closed/);

  const forgedStaleRevisionReceipt = JSON.parse(readFileSync(phaseReceipt.receipt_path, 'utf8'));
  forgedStaleRevisionReceipt.gallery.path = rel(root, staleRevisionGalleryPath);
  forgedStaleRevisionReceipt.upstream_digests.gallery_manifest = `sha256:${sha256(readFileSync(staleRevisionGalleryPath))}`;
  forgedStaleRevisionReceipt.receipt_digest = receiptDigest(forgedStaleRevisionReceipt);
  const forgedStaleRevisionReceiptPath = join(root, '.yam', 'ueye', 'design-production', 'bounded', 'forged-stale-revision-receipt.json');
  writeJson(forgedStaleRevisionReceiptPath, forgedStaleRevisionReceipt);
  const forgedStaleRevisionVerification = await verifyDesignProductionPhaseReceipt({
    root,
    receipt_path: rel(root, forgedStaleRevisionReceiptPath)
  });
  assert.equal(forgedStaleRevisionVerification.ready, false, JSON.stringify(forgedStaleRevisionVerification));
  assert.match(forgedStaleRevisionVerification.errors.join(' '), /gallery chronology.*created before the final revision round was recorded/);

  for (const [name, mutate, expected] of [
    ['forged-gallery-claim', (receipt) => { receipt.gallery.claims.visual_correctness = 'verified'; }, /gallery semantics/],
    ['forged-ready', (receipt) => { receipt.ready = true; receipt.phase_evidence_status = 'complete'; }, /ready\/phase_evidence_status/],
    ['forged-demand', (receipt) => { receipt.demand_trigger.evidence = 'Redigested demand evidence that was never recorded in the Canvas.'; }, /demand_trigger/]
  ]) {
    const forged = JSON.parse(readFileSync(phaseReceipt.receipt_path, 'utf8'));
    mutate(forged);
    forged.receipt_digest = receiptDigest(forged);
    const forgedPath = join(root, '.yam', 'ueye', 'design-production', 'bounded', `${name}.json`);
    writeJson(forgedPath, forged);
    const forgedVerification = await verifyDesignProductionPhaseReceipt({ root, receipt_path: rel(root, forgedPath) });
    assert.equal(forgedVerification.ready, false, `${name} unexpectedly verified`);
    assert.match(forgedVerification.errors.join(' '), expected);
  }

  const unlinkedPhaseState = JSON.parse(readFileSync(phaseState.state_path, 'utf8'));
  unlinkedPhaseState.rounds[1].reviewer_finding.source_comment_id = 'missing-canvas-comment';
  writeJson(phaseState.state_path, unlinkedPhaseState);
  const tamperedPhaseVerification = await verifyDesignProductionPhaseReceipt({
    root,
    receipt_path: rel(root, phaseReceipt.receipt_path)
  });
  assert.equal(tamperedPhaseVerification.ready, false);
  assert.match(tamperedPhaseVerification.errors.join(' '), /revision_state digest mismatch/);
  await assert.rejects(() => finalizeDesignProductionPhase({
    root,
    demand_trigger: repeatedDemand,
    canvas_session_path: rel(root, phaseCanvas.session_path),
    revision_state_path: rel(root, phaseState.state_path),
    gallery_manifest_path: rel(root, phaseGalleryPath),
    receipt_path: '.yam/ueye/design-production/bounded/unlinked-phase-receipt.json'
  }), /not linked to a Canvas comment id/);

  const cliCanvas = await createPlanReviewCanvas({
    root,
    session_id: 'cli-approved',
    title: 'CLI phase finalization',
    demand_trigger: {
      kind: 'multi_asset_production',
      evidence: 'A coordinated multi-asset package requires a bounded final review receipt.'
    },
    artifacts: [{ id: 'cli-plan', role: 'plan', file_path: rel(root, plan) }]
  });
  await closePlanReviewCanvas({
    root,
    session_path: rel(root, cliCanvas.session_path),
    render_path: rel(root, cliCanvas.render_path),
    verdict: 'approve'
  });
  const cliGalleryPath = join(root, '.yam', 'ueye', 'design-production', 'cli-approved', 'gallery.json');
  await writeFinalGalleryManifest({
    root,
    manifest_path: rel(root, cliGalleryPath),
    session_id: 'cli-approved',
    completion_state: 'packaged',
    artifacts: [{ ...galleryArtifact, completion_state: 'packaged' }]
  });
  const cliResult = JSON.parse(execFileSync(join(process.cwd(), 'dist', 'bin', 'yam.js'), [
    'ueye', 'production', 'finalize',
    '--root', root,
    '--demand-kind', 'multi_asset_production',
    '--demand-evidence', 'A coordinated multi-asset package requires a bounded final review receipt.',
    '--canvas-session-path', rel(root, cliCanvas.session_path),
    '--gallery-manifest-path', rel(root, cliGalleryPath),
    '--receipt-path', '.yam/ueye/design-production/cli-approved/phase-receipt.json',
    '--json'
  ], { encoding: 'utf8' }));
  assert.equal(cliResult.schema, 'yam.design-production-phase-receipt.v1');
  assert.equal(cliResult.ready, true);
  assert.equal(cliResult.ready_to_claim_correctness, false);
  assert.equal(cliResult.demand_trigger.evidence_truth, 'operator_asserted');
  assert.equal(cliResult.truth_status, 'partial');
  const cliPhaseVerification = JSON.parse(execFileSync(join(process.cwd(), 'dist', 'bin', 'yam.js'), [
    'ueye', 'production', 'phase', 'verify',
    '--root', root,
    '--receipt-path', rel(root, cliResult.receipt_path),
    '--json'
  ], { encoding: 'utf8' }));
  assert.equal(cliPhaseVerification.ready, true, JSON.stringify(cliPhaseVerification));

  await assert.rejects(() => writeFinalGalleryManifest({
    root,
    manifest_path: '.yam/ueye/design-production/bounded/bad-gallery.json',
    session_id: 'bounded',
    completion_state: 'packaged',
    artifacts: [{ ...galleryArtifact, sha256: '0'.repeat(64) }]
  }), /sha256 mismatch/);
  await assert.rejects(() => writeFinalGalleryManifest({
    root,
    manifest_path: '.yam/ueye/design-production/bounded/inconsistent-gallery.json',
    session_id: 'bounded',
    completion_state: 'packaged',
    artifacts: [galleryArtifact]
  }), /aggregate artifact state ready_for_inspection/);
  await assert.rejects(() => writeFinalGalleryManifest({
    root,
    manifest_path: '.yam/ueye/design-production/bounded/duplicate-gallery.json',
    session_id: 'bounded',
    completion_state: 'packaged',
    artifacts: [galleryArtifact, galleryArtifact]
  }), /duplicate gallery artifact id/);
  await assert.rejects(() => writeFinalGalleryManifest({
    root,
    manifest_path: '.yam/ueye/design-production/bounded/escape-gallery.json',
    session_id: 'bounded',
    completion_state: 'packaged',
    artifacts: [{ ...galleryArtifact, final_path: '../outside.png' }]
  }), /escapes the project root/);

  process.stdout.write('design production smoke: ok\n');
} finally {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
}

function fixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), 'yam-design-production-'));
  roots.push(root);
  return root;
}

function write(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, value);
}

function writeJson(file, value) {
  write(file, `${JSON.stringify(value, null, 2)}\n`);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function receiptDigest(receipt) {
  const base = { ...receipt };
  delete base.receipt_digest;
  return `sha256:${sha256(stableJson(base))}`;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function rel(root, file) {
  const realRoot = realpathSync(root);
  let realFile;
  try {
    realFile = realpathSync(file);
  } catch {
    realFile = join(realRoot, relative(root, file));
  }
  return relative(realRoot, realFile);
}
