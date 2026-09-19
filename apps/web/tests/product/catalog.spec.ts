import { test, expect, type Page } from '@playwright/test';
import type { MarketListing, NftGiftProduct } from '@everyday/contracts';

const runtimeErrors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  const errors: string[] = [];
  runtimeErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
});
test.afterEach(({ page }) => expect(runtimeErrors.get(page)).toEqual([]));

const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`;
const listings: MarketListing[] = Array.from({ length: 5 }, (_, i) => ({
  id: id(i + 1), title: `테스트 캐릭터 ${i + 1}`, creator: id(99), operator: id(99),
  active: true, published: true, priceMist: '1', agentBps: 2000, treasuryMist: '0', buyerCount: '18446744073709551615',
  package: { blobId: 'a'.repeat(43), contentHash: '0'.repeat(64), endEpoch: '1000' },
  policy: { perGiftLimitMist: '0', dailyLimitMist: '0', allowedGiftIds: [] },
}));
const gifts: NftGiftProduct[] = [{
  id: id(10), title: '한정 선물', description: '테스트 상품', imageUrl: 'https://images.invalid/missing.png',
  imageHash: '0'.repeat(64), merchant: id(99), priceMist: '18446744073709551615',
  maxSupply: '18446744073709551615', minted: '9007199254740993', active: true,
}, {
  id: id(11), title: '품절 선물', description: '테스트 상품', imageUrl: 'https://images.invalid/missing.png',
  imageHash: '0'.repeat(64), merchant: id(99), priceMist: '1', maxSupply: '1', minted: '1', active: true,
}];

async function fixtures(page: Page, options: { fail?: boolean; cycle?: boolean } = {}) {
  await page.addInitScript(() => localStorage.setItem('everyday.v2.jwt', 'fixture-not-a-real-session'));
  // Prevent an unexpected SDK/provider request from reaching a live service.
  await page.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:13200'
    ? route.continue() : route.abort());
  await page.route('https://images.invalid/**', route => route.fulfill({ status: 404 }));
  await page.route('http://127.0.0.1:13201/**', async route => {
    const url = new URL(route.request().url());
    if (options.fail) return route.fulfill({ status: 503, json: { error: 'UNAVAILABLE' } });
    if (url.pathname === '/v1/market/listings') return route.fulfill({ json: {
      listings, previews: Object.fromEntries(listings.map(l => [l.id, { summary: '다정한 친구', imageUrl: 'https://images.invalid/missing.png' }])),
      engagement: {}, nextCursor: options.cycle ? id(1) : null,
    } });
    if (url.pathname.endsWith('/community')) return route.fulfill({ json: { reviews: [], averageRating: null, reviewCount: 0, giftsSent: 0, registeredAt: null } });
    const listing = listings.find(l => url.pathname === `/v1/market/listings/${l.id}/preview`);
    if (listing) return route.fulfill({ json: { listing, previewTurns: 3,
      character: { name: listing.title, summary: '다정한 친구', gender: 'OTHER', imageUrl: null, speechStyles: [], examples: [] } } });
    if (url.pathname === '/v1/nft-gifts') return route.fulfill({ json: { gifts } });
    const gift = gifts.find(g => url.pathname === `/v1/nft-gifts/${g.id}`);
    if (gift) return route.fulfill({ json: { gift } });
    return route.fulfill({ status: 404, json: { error: 'NOT_FOUND' } });
  });
}

test('community filters, switches views and handles missing portraits without broken images', async ({ page }) => {
  await fixtures(page);
  await page.goto('/community');
  await expect(page.locator('article')).toHaveCount(5);
  await expect(page.locator('article img')).toHaveCount(0);
  await page.getByRole('textbox', { name: '캐릭터 검색' }).fill('캐릭터 2');
  await expect(page.locator('article')).toHaveCount(1);
  await page.getByRole('button', { name: '스와이프로 보기', exact: true }).click();
  await expect(page.locator('[data-card]')).toHaveCount(1);
});

test('320px community portrait stays within the phone content', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await fixtures(page);
  await page.goto('/community');
  const portrait = page.getByRole('button', { name: '테스트 캐릭터 1 프로필 보기', exact: true });
  await expect(portrait).toBeVisible();
  const box = await portrait.boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(300);
});

for (const width of [320, 375, 390, 425, 768]) {
  test(`app frame, navigation and swipe cards share the responsive width at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await fixtures(page);
    await page.goto('/community');
    await expect(page.locator('article')).toHaveCount(5);
    const frame = await page.locator('.phone').boundingBox();
    const nav = await page.getByRole('navigation').boundingBox();
    expect(frame!.width).toBe(Math.min(width, 425));
    expect(nav!.width).toBe(frame!.width);
    expect(nav!.x).toBe(frame!.x);
    await page.getByRole('button', { name: '스와이프로 보기' }).click();
    const card = page.locator('[data-card]').first();
    await expect(card).toBeVisible();
    expect((await card.boundingBox())!.width).toBe(frame!.width - 40);
    await page.goto('/market');
    await expect(page.getByText('한정 선물', { exact: true })).toBeVisible();
    const cards = await page.locator('article').evaluateAll(elements => elements.map(el => {
      const rect = el.getBoundingClientRect(); return { left: rect.left, right: rect.right };
    }));
    for (const rect of cards) {
      expect(rect.left).toBeGreaterThanOrEqual(frame!.x);
      expect(rect.right).toBeLessThanOrEqual(frame!.x + frame!.width);
    }
  });
}

test('catalog failure and pagination cycles render an error, never an empty catalog', async ({ page }) => {
  await fixtures(page, { cycle: true });
  await page.goto('/community');
  await expect(page.getByRole('alert').filter({ hasText: '불러오지 못했어요' })).toBeVisible();
  await expect(page.locator('article')).toHaveCount(0);
});

test('NFT catalog failure is not reported as no products', async ({ page }) => {
  await fixtures(page, { fail: true });
  await page.goto('/market');
  await expect(page.getByRole('alert').filter({ hasText: '불러오지 못했어요' })).toBeVisible();
  await expect(page.getByText('판매 준비 중인 NFT 선물이 있어요')).toHaveCount(0);
});

test('NFT prices/supply are exact, images fail gracefully, sold-out purchase is disabled', async ({ page }) => {
  await fixtures(page);
  await page.goto('/market');
  await expect(page.getByText('18446744073.709551615 SUI', { exact: true })).toBeVisible();
  await expect(page.getByText('· 18437736874454810622개 남음', { exact: true })).toBeVisible();
  await expect(page.locator('article img')).toHaveCount(0);
  await page.getByRole('link').filter({ hasText: '품절 선물' }).press('Enter');
  await expect(page.getByRole('button', { name: '품절', exact: true })).toBeDisabled();
});

test('missing detail identifiers fail visibly instead of an empty screen', async ({ page }) => {
  await fixtures(page);
  await page.goto('/community/detail');
  await expect(page.getByRole('alert').filter({ hasText: '찾을 수 없어요' })).toBeVisible();
  await page.goto('/community/gifts/detail');
  await expect(page.getByRole('alert').filter({ hasText: '찾을 수 없어요' })).toBeVisible();
});

test('client-side profile navigation clears old data and recovers from missing identifiers', async ({ page }) => {
  await fixtures(page);
  await page.goto(`/community/detail?listing=${id(1)}`);
  await expect(page.getByRole('heading', { name: listings[0].title, exact: true })).toBeVisible();
  await page.evaluate(() => window.history.pushState(null, '', '/community/detail'));
  await expect(page.getByRole('alert').filter({ hasText: '찾을 수 없어요' })).toBeVisible();
  await expect(page.getByRole('heading', { name: listings[0].title, exact: true })).toHaveCount(0);
  await page.evaluate(url => window.history.pushState(null, '', url), `/community/detail?listing=${id(2)}`);
  await expect(page.getByRole('heading', { name: listings[1].title, exact: true })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: '찾을 수 없어요' })).toHaveCount(0);
});

test('client-side gift navigation removes the old purchase action on a failed load', async ({ page }) => {
  await fixtures(page);
  await page.goto(`/community/gifts/detail?product=${id(10)}`);
  await expect(page.getByRole('button', { name: '내 지갑으로 구매하기' })).toBeVisible();
  await page.evaluate(url => window.history.pushState(null, '', url), `/community/gifts/detail?product=${id(999)}`);
  await expect(page.getByRole('alert').filter({ hasText: '불러오지 못했어요' })).toBeVisible();
  await expect(page.getByRole('button', { name: '내 지갑으로 구매하기' })).toHaveCount(0);
  await page.evaluate(url => window.history.pushState(null, '', url), `/community/gifts/detail?product=${id(11)}`);
  await expect(page.getByRole('button', { name: '품절', exact: true })).toBeDisabled();
  await expect(page.getByRole('alert').filter({ hasText: '불러오지 못했어요' })).toHaveCount(0);
});

test('preferences failure cannot overwrite blocklist or hide owned NFTs', async ({ page }) => {
  await fixtures(page);
  await page.route('**/v1/me/nft-gifts', route => route.fulfill({ json: { gifts: [{ ...gifts[0], productId: gifts[0].id, edition: '1' }] } }));
  await page.goto('/my/gifts');
  await expect(page.getByRole('alert').filter({ hasText: '수신 설정을 불러오지 못했어요' })).toBeVisible();
  await expect(page.getByRole('button', { name: '받지 않음' })).toBeDisabled();
  await expect(page.getByText('한정 선물', { exact: true })).toBeVisible();
  await expect(page.locator('article img')).toHaveCount(0);
});

test('preferences stay locked until loaded and saving preserves the existing blocklist', async ({ page }) => {
  await fixtures(page);
  await page.route('**/v1/me/nft-gifts', route => route.fulfill({ json: { gifts: [{ ...gifts[0], productId: gifts[0].id, edition: '1' }] } }));
  await page.route('**/v1/external-nft-collections', route => route.fulfill({ json: { collections: [] } }));
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  let saved: unknown;
  await page.route('**/v1/me/external-nft-preferences', async route => {
    if (route.request().method() === 'PUT') {
      saved = route.request().postDataJSON();
      return route.fulfill({ status: 503, json: { error: 'UNAVAILABLE' } });
    }
    await ready;
    return route.fulfill({ json: { receiveEnabled: true, blockedPolicyIds: [id(98)] } });
  });
  try {
    await page.goto('/my/gifts');
    await expect(page.getByRole('button', { name: '받지 않음' })).toBeDisabled();
    await expect(page.getByText('한정 선물', { exact: true })).toBeVisible();
  } finally { release(); }
  await page.getByRole('button', { name: '받는 중' }).click();
  await expect(page.getByRole('alert').filter({ hasText: '저장하지 못했어요' })).toBeVisible();
  expect(saved).toEqual({ receiveEnabled: false, blockedPolicyIds: [id(98)] });
  await expect(page.getByRole('button', { name: '받는 중' })).toBeEnabled();
  await expect(page.getByText('한정 선물', { exact: true })).toBeVisible();
});

test('chat observes settlement beyond three minutes and retains metadata during new messages', async ({ page }) => {
  await fixtures(page);
  await page.clock.install();
  const character = { id: 1, name: '친구', callName: '나', speechStyles: [], profileImageUrl: null };
  await page.route('**/api/characters', route => route.fulfill({ json: { success: true, data: [character] } }));
  await page.route('**/api/characters/1', route => route.fulfill({ json: { success: true, data: character } }));
  let reads = 0;
  await page.route('**/api/characters/1/messages', route => {
    if (route.request().method() === 'POST') return route.fulfill({ json: { success: true, data: { id: 2, sender: 'AI', content: '새 답변', createdAt: new Date().toISOString() } } });
    reads++;
    return route.fulfill({ json: { success: true, data: [{ id: 1, sender: 'AI', content: '안녕', createdAt: new Date().toISOString(),
      gift: { status: reads > 19 ? 'confirmed' : 'unknown', productId: gifts[0].id, digest: 'test-digest' } }] } });
  });
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/v1/nft-gifts/${gifts[0].id}`, async route => {
    await ready; return route.fulfill({ json: { gift: gifts[0] } });
  });
  try {
    await page.goto('/chat');
    await expect(page.getByText('선물을 준비하고 있어요')).toBeVisible();
    for (let i = 1; i <= 19; i++) {
      await page.clock.runFor(10_100);
      await expect.poll(() => reads).toBeGreaterThanOrEqual(i + 1);
    }
    await expect(page.getByText('🎁 NFT 선물이 도착했어요')).toBeVisible();
    await page.getByPlaceholder('친구에게 메시지').fill('계속 이야기하자');
    await page.getByPlaceholder('친구에게 메시지').press('Enter');
    await expect(page.getByText('새 답변', { exact: true })).toBeVisible();
  } finally { release(); }
  await expect(page.getByText('한정 선물', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '거래 보기' })).toHaveAttribute('href', /test-digest$/);
});
