import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getVaultConfig, getStoredVaultConfig, setVaultConfig, isVaultEnabled, planVaultSave, planProVaultSave,
  isProConnection, PRO_VAULT_URL, VAULT_CONFIG_KEY, _resetVaultConfigSecureRestoreForTests,
} from './vaultConfig.js';
import { enrollWithAccountKey, VaultProEnrollError } from './vaultProEnroll.js';

// GLANCEvault Pro: one pasted key becomes an ordinary stored connection, so
// every reader outside the form treats a Pro vault like a self-hosted one,
// and the key itself is never stored.

const KEY = 'gvk_' + 'a'.repeat(64);
const ENROLLED = { credential: 'gvc_' + 'b'.repeat(64), accountId: 'acct_1' };
const PRO_ON = { enabled: true, pro: true, vaultUrl: PRO_VAULT_URL, vaultToken: ENROLLED.credential, accountId: 'acct_1' };

function fakeStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, m };
}

let store;
beforeEach(() => { _resetVaultConfigSecureRestoreForTests(); store = fakeStorage(); globalThis.localStorage = store; });
afterEach(() => { delete globalThis.localStorage; });

describe('planProVaultSave', () => {
  it('a pasted key on a fresh device means enroll, then store the enrolled connection', () => {
    const plan = planProVaultSave(null, { accountKey: `  ${KEY}  ` });
    expect(plan).toMatchObject({ next: null, changed: true, connectionChanged: true, needsEnroll: true });
    expect(plan.withEnrollment(ENROLLED)).toEqual({ next: PRO_ON, changed: true, connectionChanged: true });
  });

  it('an unchanged Pro connection saves nothing and needs no passphrase', () => {
    expect(planProVaultSave(PRO_ON, { accountKey: '' })).toMatchObject({
      next: PRO_ON, changed: false, connectionChanged: false, needsEnroll: false,
    });
  });

  it('a paused Pro connection resumes without a key, keeping its place', () => {
    const paused = planVaultSave(PRO_ON, { enabled: false }).next;
    expect(paused).toEqual({ ...PRO_ON, enabled: false });
    expect(planProVaultSave(paused, { accountKey: '' })).toMatchObject({
      next: PRO_ON, changed: true, connectionChanged: false, needsEnroll: false,
    });
  });

  it('a new key on a connected device re-enrolls, and re-keys only if the result differs', () => {
    const plan = planProVaultSave(PRO_ON, { accountKey: KEY });
    expect(plan.needsEnroll).toBe(true);
    expect(plan.withEnrollment({ credential: 'gvc_new', accountId: 'acct_1' }).connectionChanged).toBe(true);
  });

  it('switching a self-hosted vault to Pro without a key has nothing to save', () => {
    const selfHosted = { enabled: true, vaultUrl: 'https://vault.example', vaultToken: 'tok', accountId: 'house' };
    expect(isProConnection(selfHosted)).toBe(false);
    expect(planProVaultSave(selfHosted, { accountKey: '' })).toMatchObject({ next: null, changed: false, needsEnroll: false });
  });

  it('the stored Pro connection is what the engine reads, with no key in it', () => {
    setVaultConfig(planProVaultSave(null, { accountKey: KEY }).withEnrollment(ENROLLED).next);
    expect(isVaultEnabled()).toBe(true);
    expect(getVaultConfig()).toEqual(PRO_ON);
    expect(store.getItem(VAULT_CONFIG_KEY)).not.toContain(KEY);
    expect(getStoredVaultConfig().vaultUrl).toBe('https://sync.glancevault.com');
  });
});

describe('enrollWithAccountKey', () => {
  const recorder = (reply) => {
    const calls = [];
    const fetchImpl = async (method, url, headers, body) => {
      calls.push({ method, url, headers, body: JSON.parse(body) });
      if (reply instanceof Error) throw reply;
      return reply;
    };
    return { calls, fetchImpl };
  };

  it('posts the key and this device id once, and returns the credential and account', async () => {
    const { calls, fetchImpl } = recorder({ status: 201, ok: true, body: JSON.stringify({ ...ENROLLED, credentialId: 'c1' }) });
    const out = await enrollWithAccountKey(` ${KEY} `, { fetchImpl, deviceId: 'dev-1' });
    expect(out).toEqual(ENROLLED);
    expect(calls).toEqual([{
      method: 'POST',
      url: `${PRO_VAULT_URL}/enroll`,
      headers: { 'Content-Type': 'application/json' },
      body: { accountKey: KEY, deviceId: 'dev-1' },
    }]);
  });

  it.each([[401], [403]])('a %i is a rejected key', async (status) => {
    const { fetchImpl } = recorder({ status, ok: false, body: '{"error":"invalid account key"}' });
    await expect(enrollWithAccountKey(KEY, { fetchImpl, deviceId: 'd' })).rejects.toMatchObject({ code: 'KEY_REJECTED', status });
  });

  it('a network failure or a server without enrollment is unavailable', async () => {
    await expect(enrollWithAccountKey(KEY, { ...recorder(new TypeError('Failed to fetch')), deviceId: 'd' }))
      .rejects.toMatchObject({ code: 'UNAVAILABLE' });
    await expect(enrollWithAccountKey(KEY, { ...recorder({ status: 404, ok: false, body: '' }), deviceId: 'd' }))
      .rejects.toMatchObject({ code: 'UNAVAILABLE', status: 404 });
  });

  it('a server error or a reply without a credential is a server error', async () => {
    await expect(enrollWithAccountKey(KEY, { ...recorder({ status: 500, ok: false, body: '' }), deviceId: 'd' }))
      .rejects.toMatchObject({ code: 'SERVER_ERROR', status: 500 });
    await expect(enrollWithAccountKey(KEY, { ...recorder({ status: 201, ok: true, body: '{"accountId":"a"}' }), deviceId: 'd' }))
      .rejects.toBeInstanceOf(VaultProEnrollError);
  });

  it('an empty key never reaches the network', async () => {
    const { calls, fetchImpl } = recorder({ status: 201, ok: true, body: '{}' });
    await expect(enrollWithAccountKey('   ', { fetchImpl, deviceId: 'd' })).rejects.toMatchObject({ code: 'KEY_REJECTED' });
    expect(calls).toHaveLength(0);
  });
});
