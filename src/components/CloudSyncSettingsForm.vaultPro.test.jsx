import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../../public/locales/en/translation.json';
import CloudSyncSettingsForm from './CloudSyncSettingsForm.jsx';
import { VAULT_CONFIG_KEY, PRO_VAULT_URL, _resetVaultConfigSecureRestoreForTests } from '../sync/vaultConfig.js';

// The GLANCEvault card: with Pro checked it asks for the account key alone;
// a self-hosted connection keeps its URL, token and account fields.
describe('CloudSyncSettingsForm GLANCEvault Pro', () => {
  const original = globalThis.localStorage;
  let stored = null;
  beforeAll(async () => {
    globalThis.localStorage = {
      getItem: (k) => (k === VAULT_CONFIG_KEY && stored ? JSON.stringify(stored) : null),
      setItem() {}, removeItem() {},
    };
    await i18n.use(initReactI18next).init({ lng: 'en', resources: { en: { translation: en } }, interpolation: { escapeValue: false } });
  });
  afterAll(() => { globalThis.localStorage = original; });

  const render = (cfg) => {
    stored = cfg;
    _resetVaultConfigSecureRestoreForTests();
    return renderToStaticMarkup(
      <CloudSyncSettingsForm
        darkMode={false} textPrimary="" textSecondary="" borderClass="" hoverBg="" currentProvider="webdav"
        cloudSyncConfig={{ enabled: false, provider: 'webdav' }}
        setCloudSyncConfig={() => {}}
      />,
    );
  };
  const f = en.sync.form;

  it('a Pro connection shows the key field and none of the self-hosted fields', () => {
    const html = render({ enabled: true, pro: true, vaultUrl: PRO_VAULT_URL, vaultToken: 'gvc_x', accountId: 'acct_1' });
    expect(html).toContain('data-vault-pro');
    expect(html).toContain('data-vault-account-key');
    expect(html).toContain(f.vaultProConnected);
    expect(html).not.toContain(f.vaultUrlLabel);
    expect(html).not.toContain(f.deviceTokenLabel);
    expect(html).not.toContain(f.accountIdLabel);
    expect(html).not.toContain(f.vaultExperimentalWarning);
    expect(html).not.toContain('gvc_x');
  });

  it('a self-hosted connection keeps its fields and offers the Pro box unchecked', () => {
    const html = render({ enabled: true, vaultUrl: 'https://vault.example', vaultToken: 'tok', accountId: 'house' });
    expect(html).toContain(f.vaultProToggle);
    expect(html).toContain(f.vaultUrlLabel);
    expect(html).toContain(f.accountIdLabel);
    expect(html).not.toContain('data-vault-account-key');
    expect(html).not.toMatch(/data-vault-pro[^>]*checked|checked[^>]*data-vault-pro/);
  });
});
