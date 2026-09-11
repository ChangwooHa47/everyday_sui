import { test, expect } from '@playwright/test';
test('market and secondary viewer have distinct entry points and do not expose unauthenticated memory', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/market');
  await expect(page.getByRole('heading', { name: '캐릭터 마켓', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '지갑으로 시작해요' })).toBeVisible();
  await expect(page.getByRole('button', { name: '확인한 기억 저장' })).toHaveCount(0);
  await page.getByRole('link', { name: '기억 뷰어', exact: true }).click();
  await expect(page.getByRole('heading', { name: '나의 이야기 이어가기', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
