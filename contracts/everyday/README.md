# Everyday Move package

The marketplace uses `market.move`: Creator registration, shared Listing objects,
non-transferable personal License objects, purchase settlement, GiftProduct and GiftReceipt.
Each Listing holds its character's SUI treasury. Move enforces the operator, allowed gifts,
per-gift and daily spending limits, and one execution per intent. An ordinary operator
wallet balance is not policy-controlled character spending money.

Character settings are immutable after publication; a new edition is a new Listing.
Delisting stops purchases without removing existing buyer access. Private conversations
and memories are not part of a Listing or License. Seal approval checks the exact Listing
identity and the creator, operator or recorded buyer.

`character.move` and `vault.move` remain legacy modules. Their transferable Character and
owner-bound UserVault objects are separate from marketplace licenses; the current app uses
Spring for private character records and MemWal for approved personal memories.
See [market architecture](../../docs/MARKET_PIVOT.md) for the complete application boundary.

## Storage boundary

Move records the blob ID, ciphertext hash and Walrus retention epoch. It validates their
shape, not storage certification or availability. Walrus and Sui epochs are different
clocks; `extend_retention` updates metadata and does not pay for or prove storage renewal.

The API verifies canonical Walrus Blob/BlobCertified receipts, non-deletable storage,
ciphertext download/hash and Seal decryption. Non-deletable storage still has a retention
period. Renewal remains an operational task. Seal grants access; it does not prevent copying.

## Validation and deployment

Use the pinned Sui CLI `testnet-v1.79.0`. Root scripts select `SUI_BIN`, the local pinned
Windows binary, or `sui` on PATH. `Move.lock` retains portable dependency paths.

```powershell
npm.cmd run test:move
npm.cmd run build:move
```

The [current testnet deployment](deployments/testnet.json) is v2, published on 2026-09-12.
Admin/UpgradeCap ownership and package binding were verified. Further evidence is separate:

- [Purchase/storage verification](deployments/testnet-verification.json): actual testnet
  purchase, creator/treasury settlement, Walrus storage, operator/buyer Seal decryption,
  and a Move gift-policy transaction. This does not prove an LLM gift decision or fulfillment.
- [Memory verification](deployments/memory-verification.json): actual MemWal remember/recall,
  owner rejection and character namespace isolation using fictional approved data.
- [API verification](deployments/api-verification.json): actual chain/storage/memory adapters
  through two authenticated Origins, with an isolated database and no browser/UI test.
- [Seed publications](deployments/market-seed.json): ten fictional characters and original
  images stored on Walrus. Production catalog registration is a separate deployment step.

To reconcile the saved v2 publication, run from the repository root:

```powershell
node infra/deploy-testnet.mjs --execute --deployment-state market-testnet-v2
```

The script checks the source identity and reuses the saved signed transaction. Source
changes do not automatically create another package. Keep signing keys and saved signed
transactions in private storage. See the [deployment review](../../infra/DEPLOYMENT_REVIEW.md)
for current application checks, external dependencies and unfinished work.
