import { test, expect } from '@playwright/test';

test('create, chat, episode, photo and gallery use the real backend API', async ({ page, request }, testInfo) => {
  const signup = await request.post('http://127.0.0.1:18080/api/auth/signup', {
    data: { email: `browser-${Date.now()}@baseline.test`, password: 'baseline123!' },
  });
  expect(signup.status()).toBe(201);
  const token = (await signup.json()).data.accessToken;
  await page.addInitScript(token => localStorage.setItem('everyday.v2.jwt', token), token);

  await page.goto('/create');
  await page.getByRole('button', { name: '친구', exact: true }).click();
  await page.getByRole('button', { name: '남성', exact: true }).click();
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await page.locator('textarea').fill('함께 산책하는 다정한 친구');
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await page.getByRole('button', { name: '다정한 친구', exact: true }).click();
  await page.getByRole('button', { name: /이 정도면 됐어요/ }).click();
  await page.locator('input').first().fill('기준친구');
  await page.getByRole('button', { name: '생성', exact: true }).click();
  await expect(page.getByText('캐릭터가 생성되었어요')).toBeVisible();
  await page.getByRole('button', { name: '프로필 사진 만들기', exact: true }).click();
  await page.getByRole('button', { name: '이 느낌으로 사진 만들기', exact: true }).click();
  await page.locator('button:has(img)').first().click();
  await page.getByRole('button', { name: '확정', exact: true }).click();
  await expect(page).toHaveURL(/\/home$/);
  await page.getByRole('link', { name: '대화하기', exact: true }).click();
  await page.getByPlaceholder('예: 자기야, 은우야, 야').fill('테스터');
  await page.getByPlaceholder('예: 자기야, 은우야, 야').press('Enter');
  await page.getByPlaceholder('기준친구에게 메시지').fill('안녕 기준친구');
  await page.getByPlaceholder('기준친구에게 메시지').press('Enter');
  await expect(page.getByText('안녕 기준친구', { exact: true })).toBeVisible();
  await expect(page.locator('.bubble.char')).toHaveCount(2);
  await expect(page.locator('.typing')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('chat.png'), fullPage: true });

  await page.goto('/episode');
  await page.getByRole('button', { name: /첫 데이트/ }).click();
  await page.getByRole('button', { name: '같이 산책할까?', exact: true }).click();
  await expect(page).toHaveURL(/\/chat\?episode=/);
  await expect(page.getByText('같이 산책할까?', { exact: true })).toBeVisible();
  await expect(page.locator('.typing')).toHaveCount(0);

  await page.goto('/photobooth');
  await page.getByRole('button', { name: /카페 데이트/ }).click();
  const photoResponse = page.waitForResponse(response => response.url().endsWith('/photos') && response.request().method() === 'POST');
  await page.getByRole('button', { name: '생성', exact: true }).click();
  expect((await photoResponse).status()).toBe(200);
  await expect(page.locator('img[src^="data:image/"]').first()).toBeVisible();
  await page.goto('/gallery');
  await expect(page.locator('button:has(img)')).toHaveCount(5);
  await page.screenshot({ path: testInfo.outputPath('gallery.png'), fullPage: true });
});
