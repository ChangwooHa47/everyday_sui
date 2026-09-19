import { test, expect } from '@playwright/test';

test('login offers testnet wallets and filters Phantom even when it advertises testnet', async ({ page }) => {
  await page.addInitScript(() => {
    const icon = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=';
    const wallets = [
      { name: 'Phantom', chains: ['sui:mainnet', 'sui:testnet'] },
      { name: 'Mainnet Only Fixture', chains: ['sui:mainnet'] },
      { name: 'Testnet Supported Fixture', chains: ['sui:testnet'] },
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
  await expect(page.getByText('Sui 테스트넷 · Slush 등 지원 지갑으로 연결해주세요')).toBeVisible();
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Testnet Supported Fixture', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Phantom', { exact: true })).toHaveCount(0);
  await expect(dialog.getByText('Mainnet Only Fixture', { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Slush logo Slush', exact: true })).toBeVisible();
});
