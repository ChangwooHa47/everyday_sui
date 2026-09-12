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
  published: boolean;
  active: boolean;
  package: { blobId: string; contentHash: string; endEpoch: string };
  policy: { perGiftLimitMist: string; dailyLimitMist: string; allowedGiftIds: string[] };
}

/** On-chain limited-edition gift product; SUI amounts remain decimal MIST strings. */
export interface NftGiftProduct {
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
  id: string;
  productId: string;
  title: string;
  description: string;
  imageUrl: string;
  imageHash: string;
  edition: string;
}

export interface ProductCharacter {
  name: string;
  gender?: '남성' | '여성' | '기타';
  relationshipType?: '연인' | '썸' | '친구' | '짝사랑';
  personality: string;
  summary?: string;
  appearance?: string;
  background?: string;
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
  gift?: { status: string; productId?: string; digest?: string };
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
export interface MarketCatalog { listings: MarketListing[]; previews: Record<string, { summary: string; imageUrl: string | null }>;
  engagement?: Record<string, { turns: string; revisitPercent: number }>; nextCursor: string | null; }
export interface MemoryAccountBinding { account: { accountId: string; enabled: boolean } | null; }
export interface MemorySearchResult { results: { text: string; blob_id: string; distance: number }[]; total: number; }
export interface PublicationIdentity { publicationId: string; }
/** Private authenticated transport only; never put signed transaction bytes in a public response or environment. */
export interface SignedPublicationStep { bytes: string; signature: string; digest: string; }
export interface PublicationStep { step: SignedPublicationStep | null; }
