export function verificationStatus(evidence = {}) {
  if (!evidence.checksRun) {
    return { status: 'skipped', claim: 'Verification was not run.' };
  }
  if (!evidence.checksPassed) {
    return { status: 'partial', claim: 'Checks ran, but they did not all pass.' };
  }
  if (evidence.runtimeObserved) {
    return { status: 'proven', claim: 'Passing checks and runtime evidence were observed.' };
  }
  return { status: 'verified', claim: 'The supplied local checks passed.' };
}
