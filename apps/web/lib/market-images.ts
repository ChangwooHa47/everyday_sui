import type { MarketListing } from '@everyday/contracts';
import { apiUrl } from './web3/config';

// Bundled portraits for the ten seeded characters, served ahead of the aggregator.
// NOTE: since 2026-09-19 these are the refreshed Soul portraits, so they no longer
// match the images inside the published Walrus packages. Re-upload the same files
// and republish the listings to bring the chain back in step.
const seedImageFallbacks: Readonly<Record<string, string>> = Object.freeze({
  '0xfe481d4e933065cf4c6e2568e51ca4947ac5d3d88d1e5549dd28c3780f4dfd25': '/portraits/seed/doyun.jpg',
  '0x65fed12c7635f3c0706e571c6bd3b1ec28fb3f8c37e79e99ff987148631f0fc0': '/portraits/seed/seoyeon.jpg',
  '0x66d75c14a2524260bd86dfdc252a989df68cd3b390facb6c40cc54c588a74544': '/portraits/seed/minji.jpg',
  '0x5baeecc27ff1cba3fd64f1d62a7b62feba49ef2e29761c99f5c077757a612604': '/portraits/seed/jihu.jpg',
  '0x5456762d7ba641fc37e8c5781259294ce9bfae0cde31a3f83f55b65db88336e4': '/portraits/seed/harin.jpg',
  '0xfb628855e5d4a5b71f4428513c8d40af495b568747c3f78ad25725e5478c2350': '/portraits/seed/taeo.jpg',
  '0xd4f59f751dbc442b92987cc2a9978f99dca4213da980756c106780917e16f7fe': '/portraits/seed/yuna.jpg',
  '0x443a243b74177568ba149a040f3e0d924b9e9d2f52f03d0e509ae6cd7e877010': '/portraits/seed/subin.jpg',
  '0xc8827e0c92569b4cc686f884462fc9c0ed58950d1549d128b18a2dc41cbee98e': '/portraits/seed/siu.jpg',
  '0xdd868558e50779d0e3b8ad41847a176838e0c7a42dc4a60a4a27775e8d6128dc': '/portraits/seed/yerin.jpg',
});

/** Return trusted candidates in priority order. Deployed seeds use their
 * byte-identical bundled copy first. Other Walrus reads request the
 * aggregator's supported consistency check, which also avoids a plain URL's
 * stale negative CDN entry without adding an unsupported cache-buster query.
 */
export function marketImageSources(listing: MarketListing, imageUrl?: string | null): string[] {
  const sources: string[] = [];
  const fallback = seedImageFallbacks[listing.id];
  if (fallback) sources.push(fallback);
  if (imageUrl) {
    try {
      const url = new URL(imageUrl);
      if (url.protocol !== 'https:') throw Error('insecure');
      const original = url.toString();
      // Walrus aggregators answer with no Content-Type plus `nosniff`, which browsers
      // refuse to paint. The API re-serves the same bytes with a real media type.
      sources.push(`${apiUrl}/v1/market/listings/${encodeURIComponent(listing.id)}/preview-image`);
      if (/^\/v1\/blobs\/[A-Za-z0-9_-]{43}$/.test(url.pathname)) {
        url.searchParams.set('strict_consistency_check', 'true');
      }
      sources.push(url.toString());
      if (url.toString() !== original) sources.push(original);
    } catch {
      // Package validation normally rejects malformed URLs. If legacy data
      // slips through, omit it instead of handing an invalid src to the DOM.
    }
  }
  return sources;
}
