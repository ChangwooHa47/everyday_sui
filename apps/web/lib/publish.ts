import { Transaction } from '@mysten/sui/transactions';
import { TransactionError } from '@mysten/sui/client';
import { fromBase64, fromHex, normalizeSuiAddress } from '@mysten/sui/utils';
import type { MarketListing, ProductCharacter, PublicationIdentity, PublicationStep, SignedPublicationStep } from '@everyday/contracts';
import { backend } from './api';
import { marketRequest } from './market';
import { requirePackage } from './web3/config';
import { SCENARIOS } from './scenarios';
import { encode, sha256 } from './web3/schema';
import { priceToMist } from './sui-amount';
export { priceToMist } from './sui-amount';

/** Gift policy is fixed at Listing creation (market.move has no later override), so it is part of the publication fingerprint. */
export interface GiftPolicyInput { perGiftLimitMist: string; dailyLimitMist: string; allowedGiftIds: string[] }
const noGifts: GiftPolicyInput = { perGiftLimitMist: '0', dailyLimitMist: '0', allowedGiftIds: [] };

/** Each authored edition has one durable identity; every tab resumes its first signed transaction. */
export async function publishCharacter(characterId: number, price: string, giftPolicy: GiftPolicyInput = noGifts) {
  const { walletKit, getWalletToken } = await import('./wallet-auth');
  getWalletToken();
  const connectedAccount = walletKit.stores.$connection.get().account;
  if (!connectedAccount) throw Error('로그인해주세요.');
  const account = connectedAccount;
  const owner = normalizeSuiAddress(account.address), pkg = requirePackage(), priceMist = priceToMist(price);
  const config = await marketRequest<{ packageId: string; operator: string | null; nftGiftPackageId?: string | null }>('/v1/market/config');
  if (config.packageId !== pkg || !config.operator) throw Error('지금은 등록할 수 없어요.');
  if (giftPolicy.allowedGiftIds.length && config.nftGiftPackageId !== pkg) throw Error('지금은 선물 기능을 켠 캐릭터를 등록할 수 없어요.');
  if (BigInt(giftPolicy.perGiftLimitMist) > BigInt(giftPolicy.dailyLimitMist) || giftPolicy.allowedGiftIds.length > 20) throw Error('선물 설정을 확인해주세요.');
  const client = walletKit.getClient('testnet');
  const source = await backend.productDraft(characterId);
  const character: ProductCharacter = { name: source.name, personality: source.personality ?? '',
    summary: source.summary ?? '', appearance: source.appearance ?? '', speechStyles: source.speechStyles,
    ...(source.gender ? { gender: source.gender } : {}),
    ...(source.relationshipType ? { relationshipType: source.relationshipType } : {}),
    ...(source.imageUrl ? { imageUrl: source.imageUrl } : {}) };
  const characterPackage = { schemaVersion: 1, network: 'testnet', packageId: pkg, character,
    preview: { name: character.name, personality: character.summary || character.personality.slice(0, 100),
      ...(character.imageUrl ? { imageUrl: character.imageUrl } : {}) },
    ...(source.examples.length ? { examples: source.examples } : {}),
    episodes: SCENARIOS.map(s => ({ id: s.id, title: s.title, setting: s.scene })) };
  const fingerprint = await sha256(encode({ characterId, characterPackage, priceMist, operator: config.operator,
    agentBps: 2000, perGiftLimitMist: giftPolicy.perGiftLimitMist, dailyLimitMist: giftPolicy.dailyLimitMist, allowedGiftIds: giftPolicy.allowedGiftIds }));
  const { publicationId } = await marketRequest<PublicationIdentity>('/v1/me/publications', { characterId, fingerprint });
  const check = () => {
    getWalletToken();
    if (walletKit.stores.$connection.get().account?.address !== account.address) throw Error('다시 로그인해주세요.');
  };
  async function step(name: string, tx: Transaction, functionName: string) {
    check();
    const path = `/v1/me/publications/${publicationId}/steps/${name}`;
    const include = { objectTypes: true } as const;
    async function lookup(pending: SignedPublicationStep) {
      const restored = Transaction.from(pending.bytes), data = restored.getData(), call = data.commands[0]?.MoveCall;
      if (data.sender !== owner || data.commands.length !== 1 || !call || call.package !== pkg || call.module !== 'market'
        || call.function !== functionName || await restored.getDigest() !== pending.digest) throw Error('등록 요청을 확인할 수 없어요.');
      try { return await client.getTransaction({ digest: pending.digest, include, signal: AbortSignal.timeout(20000) }); }
      catch (error) {
        if (!(error instanceof TransactionError) || error.reason !== 'notFound') throw error;
        return null;
      }
    }
    let pending = (await marketRequest<PublicationStep>(path)).step;
    let known = pending ? await lookup(pending) : null;
    if (known && (known.$kind !== 'Transaction' || !known.Transaction.status.success)) { pending = null; known = null; }
    if (!pending) {
      tx.setSender(owner);
      const signed = await walletKit.signTransaction({ transaction: tx, account, network: 'testnet' });
      check();
      // The API atomically retains the first authorization, including requests from other tabs.
      pending = await marketRequest<SignedPublicationStep>(path, { ...signed, digest: await Transaction.from(signed.bytes).getDigest() });
      known = await lookup(pending);
    }
    check();
    const result = known ?? await client.executeTransaction({ transaction: fromBase64(pending.bytes), signatures: [pending.signature], include, signal: AbortSignal.timeout(30000) });
    if (result.$kind !== 'Transaction' || !result.Transaction.status.success) {
      throw Error('등록을 완료하지 못했어요. 다시 시도해주세요.');
    }
    const confirmed = await client.waitForTransaction({ digest: pending.digest, include, timeout: 30000 });
    if (confirmed.$kind !== 'Transaction' || !confirmed.Transaction.status.success) throw Error('등록 결과를 확인 중이에요.');
    check(); return confirmed.Transaction;
  }

  const owned = await client.core.listOwnedObjects({ owner, type: `${pkg}::market::Creator`, limit: 1 });
  let creatorId = owned.objects.find(object => object.type === `${pkg}::market::Creator` && object.owner.$kind === 'AddressOwner'
    && normalizeSuiAddress(object.owner.AddressOwner) === owner)?.objectId;
  if (!creatorId) {
    const creator = new Transaction(); creator.moveCall({ target: `${pkg}::market::register_creator` });
    const registered = await step('creator', creator, 'register_creator');
    creatorId = Object.entries(registered.objectTypes).find(([, type]) => type === `${pkg}::market::Creator`)?.[0];
  }
  if (!creatorId) throw Error('등록 정보를 확인할 수 없어요.');
  const create = new Transaction();
  create.moveCall({ target: `${pkg}::market::create_listing`, arguments: [create.object(creatorId), create.pure.address(config.operator),
    create.pure.string(character.name), create.pure.u64(priceMist), create.pure.u64(2000),
    create.pure.u64(giftPolicy.perGiftLimitMist), create.pure.u64(giftPolicy.dailyLimitMist), create.pure.vector('address', giftPolicy.allowedGiftIds)] });
  const created = await step('listing', create, 'create_listing');
  const listingId = Object.entries(created.objectTypes).find(([, type]) => type === `${pkg}::market::Listing`)?.[0];
  if (!listingId) throw Error('등록 정보를 확인할 수 없어요.');
  const { listing } = await marketRequest<{ listing: MarketListing }>(`/v1/market/listings/${listingId}`);
  if (listing.creator !== owner || listing.priceMist !== priceMist || listing.title !== character.name || listing.operator !== config.operator)
    throw Error('기존 등록 요청의 상품 정보를 확인해주세요.');
  if (!listing.published) {
    const uploaded = await marketRequest<{ package: MarketListing['package'] }>(`/v1/market/listings/${listingId}/package`, {
      requestId: publicationId, characterPackage: { ...characterPackage, listingId },
    });
    const publish = new Transaction();
    publish.moveCall({ target: `${pkg}::market::publish`, arguments: [publish.object(listingId), publish.pure.string(uploaded.package.blobId),
      publish.pure.vector('u8', fromHex(uploaded.package.contentHash)), publish.pure.u64(uploaded.package.endEpoch)] });
    await step('publish', publish, 'publish');
  }
  await marketRequest('/v1/market/listings', { listingId });
  return listingId;
}
