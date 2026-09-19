import { test, expect } from '@playwright/test';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';

test('mainnet-only Phantom completes a signed testnet application login without a transaction', async ({ page }) => {
  const key = new Ed25519Keypair();
  await page.exposeFunction('signLoginFixture', async (message: number[], chain: string) => {
    expect(chain).toBe('sui:mainnet');
    expect(new TextDecoder().decode(Uint8Array.from(message))).toContain('Chain: sui:testnet');
    return key.signPersonalMessage(Uint8Array.from(message));
  });
  await page.addInitScript(({ address, publicKey }) => {
    const account = { address, publicKey: Uint8Array.from(publicKey), chains: ['sui:mainnet'],
      features: ['sui:signPersonalMessage', 'sui:signTransaction'] };
    const wallet = { name: 'Phantom', version: '1.0.0', chains: ['sui:mainnet'], accounts: [account],
      icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=', features: {
        'standard:connect': { version: '1.0.0', connect: async () => ({ accounts: [account] }) },
        'standard:events': { version: '1.0.0', on: () => () => {} },
        'sui:signPersonalMessage': { version: '1.0.0', signPersonalMessage: async ({ message, chain }: { message: Uint8Array; chain: string }) =>
          (window as unknown as { signLoginFixture: (message: number[], chain: string) => Promise<unknown> }).signLoginFixture(Array.from(message), chain) },
        'sui:signTransaction': { version: '2.0.0', signTransaction: async () => { throw Error('Login must never request a transaction'); } },
      } };
    const register = (api: { register: (wallet: unknown) => void }) => api.register(wallet);
    window.addEventListener('wallet-standard:app-ready', ((event: CustomEvent) => register(event.detail)) as EventListener);
    window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', { detail: register }));
  }, { address: key.toSuiAddress(), publicKey: Array.from(key.getPublicKey().toRawBytes()) });
  await page.goto('/');
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await page.getByRole('dialog').getByText('Phantom', { exact: true }).click();
  await expect(page).toHaveURL(/\/home$/);
});

test('login offers Phantom and Sui mainnet-compatible wallets', async ({ page }) => {
  await page.addInitScript(() => {
    const icon = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=';
    const wallets = [
      { name: 'Phantom', chains: ['sui:mainnet', 'sui:testnet'] },
      { name: 'Mainnet Only Fixture', chains: ['sui:mainnet'] },
      { name: 'Testnet Supported Fixture', chains: ['sui:mainnet', 'sui:testnet'] },
    ].map(config => ({ ...config, version: '1.0.0', icon, accounts: [], features: {
      'standard:connect': { version: '1.0.0', connect: async () => ({ accounts: [] }) },
      'standard:events': { version: '1.0.0', on: () => () => {} },
      'sui:signTransaction': { version: '2.0.0', signTransaction: async () => { throw Error('must not sign'); } },
    } }));
    const register = (api: { register: (...values: unknown[]) => void }) => api.register(...wallets);
    window.addEventListener('wallet-standard:app-ready', ((event: CustomEvent) => register(event.detail)) as EventListener);
    window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', { detail: register }));
  });
  await page.goto('/');
  await expect(page.getByText('Phantom · Slush 등 Sui 지갑으로 로그인')).toBeVisible();
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Testnet Supported Fixture', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Phantom', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Mainnet Only Fixture', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Slush logo Slush', exact: true })).toBeVisible();
});
