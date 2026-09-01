export type ReleaseAuthMode = 'trusted_publisher_oidc' | 'manual_token';
export type RequestedReleaseAuthMode = 'auto' | 'oidc' | 'token';

export interface TrustedPublisherWorkflowCheck {
  id: 'workflow_dispatch' | 'id_token_write' | 'cloud_hosted_runner' | 'npm_publish' | 'provenance' | 'official_registry';
  passed: boolean;
}

export interface TrustedPublisherWorkflowInspection {
  path: string;
  exists: boolean;
  configured: boolean;
  checks: TrustedPublisherWorkflowCheck[];
  missing_checks: string[];
}

export interface LocalTokenProbe {
  command: 'npm whoami';
  ok: boolean;
  note: string;
}

export interface ReleaseAuthBlocker {
  kind: 'oidc_workflow_incomplete' | 'trusted_publisher_account_unverified' | 'auth_not_verified';
  severity: 'error';
  reason: string;
  safe_next_action: string;
  command: string;
}

export function inspectTrustedPublisherWorkflowText(
  text: string,
  workflowPath = '.github/workflows/release.yml',
  exists = Boolean(text)
): TrustedPublisherWorkflowInspection {
  const source = String(text || '');
  const activeSource = source
    .split(/\r?\n/)
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
  const checks: TrustedPublisherWorkflowCheck[] = [
    { id: 'workflow_dispatch', passed: /(?:^|\n)\s*workflow_dispatch\s*:/m.test(activeSource) },
    { id: 'id_token_write', passed: /(?:^|\n)\s*id-token\s*:\s*write\s*(?:#.*)?$/m.test(activeSource) },
    { id: 'cloud_hosted_runner', passed: /(?:^|\n)\s*runs-on\s*:\s*(?:ubuntu|macos|windows)-latest\s*(?:#.*)?$/m.test(activeSource) },
    { id: 'npm_publish', passed: /(?:^|\n)\s*(?:-\s*)?(?:run:\s*(?:>-?\s*)?)?npm\s+publish\b/m.test(activeSource) },
    { id: 'provenance', passed: /(?:^|\s)--provenance(?:\s|$)/m.test(activeSource) },
    { id: 'official_registry', passed: /--registry\s+https:\/\/registry\.npmjs\.org\/?(?:\s|$)/m.test(activeSource) }
  ];
  const missingChecks = checks.filter((check) => !check.passed).map((check) => check.id);
  return {
    path: workflowPath,
    exists,
    configured: exists && missingChecks.length === 0,
    checks,
    missing_checks: missingChecks
  };
}

export function buildReleaseAuthReadiness(input: {
  workflow: TrustedPublisherWorkflowInspection;
  local_token: LocalTokenProbe;
  requested_mode?: RequestedReleaseAuthMode;
}) {
  const workflow = input.workflow;
  const requestedMode = input.requested_mode || 'auto';
  const oidcSelected = requestedMode === 'oidc' || (requestedMode === 'auto' && workflow.exists);
  const localToken = {
    command: 'npm whoami' as const,
    required_for_selected_mode: !oidcSelected,
    status: input.local_token.ok ? 'authenticated' as const : 'not_authenticated' as const,
    account: input.local_token.ok ? 'observed_redacted' : '',
    note: input.local_token.ok
      ? 'npm account observed for the optional manual-token path; username intentionally redacted'
      : input.local_token.note,
    truth_status: 'verified' as const
  };

  if (!oidcSelected) {
    const blockers: ReleaseAuthBlocker[] = input.local_token.ok ? [] : [{
      kind: 'auth_not_verified',
      severity: 'error',
      reason: input.local_token.note || 'npm whoami did not confirm an authenticated publisher for the selected manual-token path',
      safe_next_action: 'refresh npm login/token, then rerun `npm whoami` before manual-token publishing',
      command: 'npm whoami'
    }];
    return {
      schema: 'yam.release-auth-readiness.v1' as const,
      requested_mode: requestedMode,
      mode: 'manual_token' as const,
      status: input.local_token.ok ? 'authenticated' as const : 'not_authenticated' as const,
      local_token: localToken,
      trusted_publisher: {
        provider: 'github_actions' as const,
        workflow_path: workflow.path,
        workflow_status: 'not_configured' as const,
        workflow_checks: workflow.checks,
        missing_checks: workflow.missing_checks,
        account_status: 'not_applicable' as const,
        note: 'No trusted-publisher release workflow was detected; manual-token authentication remains selected.'
      },
      blockers,
      next_action: blockers[0]?.safe_next_action || 'manual-token authentication is verified; publishing still requires explicit user intent',
      truth_status: blockers.length ? 'blocked' as const : 'verified' as const
    };
  }

  const blockers: ReleaseAuthBlocker[] = workflow.configured ? [{
    kind: 'trusted_publisher_account_unverified',
    severity: 'error',
    reason: 'The local report cannot verify the npmjs.com account-side Trusted Publisher binding; npm whoami does not reflect OIDC authentication status.',
    safe_next_action: `confirm the package Trusted Publisher repository and workflow filename match ${workflow.path}, then use the hosted workflow result as authentication evidence`,
    command: 'npmjs.com package settings'
  }] : [{
    kind: 'oidc_workflow_incomplete',
    severity: 'error',
    reason: `The trusted-publisher workflow is missing required controls: ${workflow.missing_checks.join(', ')}`,
    safe_next_action: `repair ${workflow.path}, then rerun workflow pins, actionlint, and release auth smoke before publishing`,
    command: 'npm run release:auth-smoke'
  }];

  return {
    schema: 'yam.release-auth-readiness.v1' as const,
    requested_mode: requestedMode,
    mode: 'trusted_publisher_oidc' as const,
    status: workflow.configured ? 'workflow_configured_account_unverified' as const : 'workflow_incomplete' as const,
    local_token: {
      ...localToken,
      required_for_selected_mode: false,
      note: input.local_token.ok
        ? `${localToken.note}; npm whoami does not prove OIDC readiness`
        : `${localToken.note || 'no local npm token was observed'}; this does not block the selected OIDC path`
    },
    trusted_publisher: {
      provider: 'github_actions' as const,
      workflow_path: workflow.path,
      workflow_status: workflow.configured ? 'static_config_verified' as const : 'incomplete' as const,
      workflow_checks: workflow.checks,
      missing_checks: workflow.missing_checks,
      account_status: workflow.configured ? 'not_verified' as const : 'not_checked' as const,
      note: workflow.configured
        ? 'Local static checks cover the workflow only; npmjs.com account configuration and the publish-time OIDC exchange remain unverified.'
        : 'The workflow must satisfy every required control before account-side Trusted Publisher evidence is relevant.'
    },
    blockers,
    next_action: blockers[0].safe_next_action,
    truth_status: 'blocked' as const
  };
}
