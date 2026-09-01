export type ReleaseRegistryCheck = {
  id?: unknown;
  status?: unknown;
  note?: unknown;
};

export type ReleaseRegistryStatus = {
  checked: boolean;
  latest_version: string;
  not_published: boolean;
  note: string;
  parse_failed: boolean;
  queried_package: string;
  queried_version: string;
};

export function releaseRegistryStatusFromChecks(
  checks: ReleaseRegistryCheck[] = [],
  expected: { package_name?: string; version?: string } = {}
): ReleaseRegistryStatus {
  const registryCheck = checks.find((check) => check.id === 'registry_status');
  const note = String(registryCheck?.note || '');
  const base = {
    checked: false,
    latest_version: '',
    not_published: false,
    note,
    parse_failed: false,
    queried_package: '',
    queried_version: ''
  };
  if (registryCheck?.status !== 'passed') return base;

  const match = note.match(/registry:check:\s*ok\s*\((.+)@([^@\s()]+)\s+is not published\)/i);
  if (!match) return { ...base, parse_failed: true };
  const queriedPackage = String(match[1] || '').trim();
  const queriedVersion = String(match[2] || '').trim();
  const expectedPackage = String(expected.package_name || '').trim();
  const expectedVersion = String(expected.version || '').trim();
  if ((expectedPackage && queriedPackage !== expectedPackage) || (expectedVersion && queriedVersion !== expectedVersion)) {
    return {
      ...base,
      parse_failed: true,
      queried_package: queriedPackage,
      queried_version: queriedVersion
    };
  }
  return {
    ...base,
    checked: true,
    not_published: true,
    queried_package: queriedPackage,
    queried_version: queriedVersion
  };
}
