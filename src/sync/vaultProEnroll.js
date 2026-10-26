// GLANCEvault Pro enrollment: exchange the account key the person pasted for
// this device's own credential (POST /enroll on a server running
// GLANCEVAULT_ENROLLMENT_MODE=account-key, glance-vault #37).
//
// The server decides the account from the key and returns it, so the person
// never types a URL, token or account ID. The key is sent once, in the body,
// and never stored: the credential is what the device keeps, and re-enrolling
// with the key later mints a fresh credential and retires the old one.
//
// @glance-apps/sync's enrollVaultDevice speaks only the bootstrap-secret body,
// so this lives here until the package learns the key form. It rides the same
// native-safe transport as every other vault call (defaultVaultFetch), never
// a plain global fetch, which fails inside the native WebView.

import { defaultVaultFetch } from '../intents/dbIntentsTransport.js';
import { getDeviceId } from './deviceId.js';
import { PRO_VAULT_URL } from './vaultConfig.js';

export class VaultProEnrollError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = 'VaultProEnrollError';
    // KEY_REJECTED   the server does not recognise the key (401/403).
    // UNAVAILABLE    no response, or the server is not offering enrollment.
    // SERVER_ERROR   any other non-success status, or a malformed reply.
    this.code = code;
    this.status = status;
  }
}

/**
 * @param {string} accountKey - as pasted (trimmed here)
 * @param {object} [opts] - test seams: fetchImpl (positional raw fetch, as
 *   defaultVaultFetch returns), vaultUrl, deviceId
 * @returns {Promise<{credential:string, accountId:string}>}
 * @throws {VaultProEnrollError}
 */
export async function enrollWithAccountKey(accountKey, opts = {}) {
  const key = (accountKey || '').trim();
  if (!key) throw new VaultProEnrollError('KEY_REJECTED', 'No account key entered.');
  const fetchImpl = opts.fetchImpl ?? defaultVaultFetch();
  const base = (opts.vaultUrl ?? PRO_VAULT_URL).replace(/\/+$/, '');
  const deviceId = opts.deviceId ?? getDeviceId();

  let res;
  try {
    res = await fetchImpl(
      'POST',
      `${base}/enroll`,
      { 'Content-Type': 'application/json' },
      JSON.stringify({ accountKey: key, deviceId }),
    );
  } catch {
    throw new VaultProEnrollError('UNAVAILABLE', 'Could not reach GLANCEvault Pro.');
  }
  if (!res) throw new VaultProEnrollError('UNAVAILABLE', 'Could not reach GLANCEvault Pro.');

  const status = res.status;
  if (status === 401 || status === 403) {
    throw new VaultProEnrollError('KEY_REJECTED', 'The account key was not accepted.', status);
  }
  if (status === 404) {
    // /enroll is only registered on a per-account server.
    throw new VaultProEnrollError('UNAVAILABLE', 'This server does not offer enrollment.', status);
  }
  if (status !== 201 && status !== 200) {
    throw new VaultProEnrollError('SERVER_ERROR', `Enrollment failed (status ${status}).`, status);
  }

  let body;
  try {
    body = typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
  } catch {
    body = null;
  }
  const credential = body?.credential;
  const accountId = body?.accountId;
  if (typeof credential !== 'string' || !credential || typeof accountId !== 'string' || !accountId) {
    throw new VaultProEnrollError('SERVER_ERROR', 'Enrollment reply was missing the credential.', status);
  }
  return { credential, accountId };
}
