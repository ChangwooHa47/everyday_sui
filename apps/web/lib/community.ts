import type { MarketCatalog, MarketCommunity, MarketListing, MarketPreviewCard } from '@everyday/contracts';
import { marketRequest, findLicense } from './market';

/** Feed card model built from the public catalog only; never the paid package. */
export interface CommunityCard {
  listing: MarketListing;
  preview: MarketPreviewCard | undefined;
  engagement: { turns: string; revisitPercent: number } | undefined;
}

export const RELATIONSHIP_FILTERS = ['전체', '연인', '썸', '친구', '짝사랑'] as const;
export type RelationshipFilter = typeof RELATIONSHIP_FILTERS[number];
export const SORTS = [{ key: 'popular', label: '인기순' }, { key: 'newest', label: '최신순' }, { key: 'price', label: '가격순' }] as const;
export type SortKey = typeof SORTS[number]['key'];

export function toCards(catalog: MarketCatalog): CommunityCard[] {
  return catalog.listings.filter(l => l.active && l.published)
    .map(listing => ({ listing, preview: catalog.previews[listing.id], engagement: catalog.engagement?.[listing.id] }));
}

export function filterCards(cards: CommunityCard[], relationship: RelationshipFilter, query: string) {
  const q = query.trim().toLowerCase();
  return cards.filter(card => (relationship === '전체' || card.preview?.relationshipType === relationship)
    && (!q || card.listing.title.toLowerCase().includes(q) || (card.preview?.summary ?? '').toLowerCase().includes(q)));
}

function compareU64(a: string, b: string) {
  const left = BigInt(a), right = BigInt(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

export function sortCards(cards: CommunityCard[], sort: SortKey) {
  const copy = [...cards];
  if (sort === 'popular') copy.sort((a, b) => compareU64(b.engagement?.turns ?? '0', a.engagement?.turns ?? '0')
    || compareU64(b.listing.buyerCount ?? '0', a.listing.buyerCount ?? '0') || a.listing.id.localeCompare(b.listing.id));
  if (sort === 'newest') copy.sort((a, b) => (b.preview?.registeredAt ?? '').localeCompare(a.preview?.registeredAt ?? '') || a.listing.id.localeCompare(b.listing.id));
  if (sort === 'price') copy.sort((a, b) => compareU64(a.listing.priceMist, b.listing.priceMist) || a.listing.id.localeCompare(b.listing.id));
  return copy;
}

export function shortAddress(address: string) { return `${address.slice(0, 6)}…${address.slice(-4)}`; }

/** Counts arrive as u64 decimal strings. Keep them as strings so large values stay exact,
 * and fall back to '0' for absent or malformed values instead of rendering NaN. */
const count = (value?: string) => (value && /^\d+$/.test(value) ? value : '0');
export function buyerCount(listing: MarketListing): string { return count(listing.buyerCount); }
export function turnCount(card: CommunityCard): string { return count(card.engagement?.turns); }

/** '0' is a truthy string, so compare explicitly before replacing the first-buyer copy. */
export function buyersLabel(card: CommunityCard): string {
  const buyers = buyerCount(card.listing);
  if (buyers !== '0') return `${buyers}명과 함께`;
  const turns = turnCount(card);
  return turns !== '0' ? `대화 ${turns}회` : '첫 구매자를 기다려요';
}

/** Relative time for catalog registration dates. */
export function formatAgo(iso?: string): string {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return '방금';
  if (hours < 24) return `${hours}시간`;
  const days = Math.floor(hours / 24);
  return days < 30 ? `${days}일` : `${Math.floor(days / 30)}달`;
}

/** Saved characters live on this device only; nothing is written to the server or chain. */
const SAVED_KEY = 'dearmine.saved-listings';
export function savedListingIds(): string[] {
  try { const value = JSON.parse(localStorage.getItem(SAVED_KEY) ?? '[]'); return Array.isArray(value) ? value.filter(v => typeof v === 'string') : []; }
  catch { return []; }
}
export function toggleSaved(listingId: string): string[] {
  const current = savedListingIds();
  const next = current.includes(listingId) ? current.filter(id => id !== listingId) : [...current, listingId];
  try { localStorage.setItem(SAVED_KEY, JSON.stringify(next)); } catch { /* private mode: keep in memory only */ }
  return next;
}

export const community = {
  of: (listingId: string) => marketRequest<MarketCommunity>(`/v1/market/listings/${encodeURIComponent(listingId)}/community`),
  /** Finds the caller's license on-chain first; the API verifies it again before storing the review. */
  async review(listingId: string, rating: number, text: string) {
    const { restoreWalletToken, walletKit } = await import('./wallet-auth');
    await restoreWalletToken();
    const account = walletKit.stores.$connection.get().account;
    if (!account) throw Error('로그인해주세요.');
    const { normalizeSuiAddress } = await import('@mysten/sui/utils');
    const licenseId = await findLicense(normalizeSuiAddress(account.address), listingId);
    if (!licenseId) throw Error('이 캐릭터의 이용권을 구매한 뒤 후기를 남길 수 있어요.');
    return marketRequest<MarketCommunity>(`/v1/market/listings/${encodeURIComponent(listingId)}/reviews`, { rating, text, licenseId });
  },
};
