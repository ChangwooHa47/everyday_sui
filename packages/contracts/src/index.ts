/** Transport contracts only. No database entities, secrets, or signing keys. */
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
