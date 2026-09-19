/** Transport contracts only. No database entities, secrets, or signing keys. */
export interface CharacterSummary {
  id: number;
  name: string;
  age: number;
  gender: string;
  relationshipType: string;
  profileImageUrl: string | null;
}

export interface HealthResponse {
  service: 'everyday-api';
  status: 'ok';
  stage: 'foundation' | 'wallet';
}

/** Non-exclusive personal license; SUI amounts are decimal MIST strings. */
export interface MarketListing {
  id: string;
  creator: string;
  operator: string;
  title: string;
  priceMist: string;
  agentBps: number;
  treasuryMist: string;
  /** Number of wallets holding a license (on-chain buyers table size). Absent on older fixtures. */
  buyerCount?: string;
  published: boolean;
  active: boolean;
  package: { blobId: string; contentHash: string; endEpoch: string };
  policy: { perGiftLimitMist: string; dailyLimitMist: string; allowedGiftIds: string[];
    /** Treasury SUI already spent on gifts today (UTC day of the chain clock). Absent on older fixtures. */
    spentTodayMist?: string };
}

/** On-chain limited-edition gift product; SUI amounts remain decimal MIST strings. */
export interface NftGiftProduct {
  kind?: 'everyday';
  id: string;
  title: string;
  description: string;
  imageUrl: string;
  imageHash: string;
  merchant: string;
  priceMist: string;
  maxSupply: string;
  minted: string;
  active: boolean;
}

/** NFT gift currently owned by the authenticated wallet. */
export interface OwnedNftGift {
  kind?: 'everyday';
  id: string;
  productId: string;
  title: string;
  description: string;
  imageUrl: string;
  imageHash: string;
  edition: string;
}

/** Admin-approved, seller-deposited external NFT offered for a fixed SUI price. */
export interface ExternalNftGiftProduct {
  kind: 'external';
  id: string;
  collectionId: string;
  collectionName: string;
  objectId: string;
  objectType: string;
  title: string;
  description: string;
  imageUrl: string;
  imageHash: string;
  merchant: string;
  priceMist: string;
  active: boolean;
  verified: true;
}

export type NftGiftCatalogItem = NftGiftProduct | ExternalNftGiftProduct;

/** A deposited external NFT whose exact object is currently owned by this wallet. */
export interface OwnedExternalNftGift {
  kind: 'external';
  id: string;
  productId: string;
  collectionId: string;
  collectionName: string;
  objectType: string;
  title: string;
  description: string;
  imageUrl: string;
  imageHash: string;
  verified: true;
}

export type OwnedNftGiftItem = OwnedNftGift | OwnedExternalNftGift;

export interface ExternalNftCollection {
  id: string;
  name: string;
  objectType: string;
  active: boolean;
}

export interface ExternalNftOfferDraft {
  policyId: string;
  objectId: string;
  title: string;
  description: string;
  imageUrl: string;
  imageHash: string;
  priceMist: string;
}

export interface ExternalNftPreferences {
  receiveEnabled: boolean;
  blockedPolicyIds: string[];
}

/** Author-authored gift behavior. It contains no buyer-specific relationship or memory data. */
export interface GiftPersona {
  enabled: boolean;
  archetype: 'caretaker' | 'playful' | 'minimalist' | 'celebratory' | 'practical';
  generosity: number;
  spontaneity: number;
  triggers: ('comfort' | 'milestone' | 'celebration' | 'encouragement')[];
  preferredTags: string[];
  blockedTags: string[];
  cooldownHours: number;
}

export interface ProductCharacter {
  name: string;
  gender?: '남성' | '여성' | '기타';
  relationshipType?: '연인' | '썸' | '친구' | '짝사랑';
  personality: string;
  summary?: string;
  appearance?: string;
  background?: string;
  interests?: string;
  speechStyles?: string[];
  imageUrl?: string;
}

export interface MarketPreview {
  listing: MarketListing;
  character: ProductCharacter;
  previewTurns: number;
}

export interface ProductDraft {
  name: string;
  gender?: ProductCharacter['gender'];
  relationshipType?: ProductCharacter['relationshipType'];
  personality: string | null;
  summary: string | null;
  appearance: string | null;
  speechStyles: string[];
  imageUrl: string | null;
  examples: { role: 'user' | 'assistant'; content: string }[];
}

// Original off-chain product API DTOs, served by Spring through the authenticated gateway.
export interface CharacterDetail {
  id: number;
  name: string;
  birthday: string | null;
  age: number;
  relationshipType: string;
  gender: string;
  summary: string | null;
  appearance: string | null;
  personality: string | null;
  speechStyles: string[];
  profileImageUrl: string | null;
  callName: string | null;
  soulTrained: boolean;
  readOnlySettings?: boolean;
}

export interface ChatMessage {
  id: number;
  sender: "USER" | "AI";
  content: string;
  createdAt: string;
  /** Agent gift outcome for this reply. `reason` is the companion's private one-line note to the recipient. */
  gift?: { status: string; productId?: string; digest?: string; reason?: string };
}

export interface InterviewQuestion {
  category: string;
  question: string;
  suggestedAnswers: string[];
  done: boolean;
}

export interface InterviewAnswer {
  category: string;
  question: string;
  answer: string;
}

export interface PhotoItem {
  id: number;
  imageUrl: string;
  concept: string | null;
  type: "PROFILE" | "PHOTOBOOTH";
  selected: boolean;
}

export interface CompileResult {
  character: CharacterDetail;
  candidatePortraits: PhotoItem[];
}

export interface EpisodeItem {
  id: number;
  code: string;
  title: string;
  emoji: string | null;
  description: string;
}

export interface EpisodeStart {
  characterEpisodeId: number;
  title: string;
  emoji: string | null;
  description: string;
  status: string;
  starters: string[];
}

export interface PhotoConcept {
  code: string;
  label: string;
}

export interface MyPage {
  id: number;
  email: string;
  subscriptionTier: string;
  characters: CharacterSummary[];
}

export interface PhotoJob {
  requestId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  photo: PhotoItem | null;
}

export interface PhotoPaymentTransaction {
  network: 'testnet';
  transaction: string;
  priceMist: string;
}

export interface LicenseBinding { listingId: string; licenseId: string; }
/** Public-safe preview metadata registered with the catalog; never the paid package. */
export interface MarketPreviewCard { summary: string; imageUrl: string | null; relationshipType?: string | null; gender?: string | null; registeredAt?: string; }
export interface MarketCatalog { listings: MarketListing[]; previews: Record<string, MarketPreviewCard>;
  engagement?: Record<string, { turns: string; revisitPercent: number }>; nextCursor: string | null; }
/** One short buyer review per wallet and listing. Conversation text never appears here. */
export interface MarketReview { owner: string; rating: number; text: string; createdAt: string; }
export interface MarketCommunity { reviews: MarketReview[]; averageRating: number | null; reviewCount: number; giftsSent: number; registeredAt: string | null; }
export interface MemoryAccountBinding { account: { accountId: string; enabled: boolean; autoStore: boolean } | null; }
export interface MemorySearchResult { results: { text: string; blob_id: string; distance: number }[]; total: number; }
export type AutomaticMemoryKind = 'preference' | 'promise' | 'shared_experience' | 'anniversary' | 'relationship_change';
export type AutomaticMemoryStatus = 'pending' | 'submitting' | 'submitted' | 'checking' | 'stored' | 'failed' | 'unknown' | 'superseded' | 'filtered';
export type PromiseMemoryStatus = 'planned' | 'completed' | 'cancelled';
/** Private server-side mapping for an automatically extracted long-term memory. */
export interface AutomaticMemoryRecord {
  id: string;
  characterId: number;
  listingId: string;
  sourceUserMessageId: number;
  sourceAiMessageId: number;
  kind: AutomaticMemoryKind;
  summary: string;
  confidence: number;
  eventDate: string | null;
  promiseStatus: PromiseMemoryStatus | null;
  status: AutomaticMemoryStatus;
  supersedesId: string | null;
  createdAt: string;
}
export interface PublicationIdentity { publicationId: string; }
/** Private authenticated transport only; never put signed transaction bytes in a public response or environment. */
export interface SignedPublicationStep { bytes: string; signature: string; digest: string; }
export interface PublicationStep { step: SignedPublicationStep | null; }
