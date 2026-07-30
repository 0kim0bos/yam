import { normalizeEmail } from './normalize-email.mjs';

export function inviteUser(email) {
  return { invitedEmail: normalizeEmail(email) };
}
