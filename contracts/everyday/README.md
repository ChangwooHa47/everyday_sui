# Everyday Move package

Validated with Sui CLI `testnet-v1.79.0`, which resolves implicit Sui framework dependencies.
The marketplace uses `market.move`: Creator, shared Listing with a policy-controlled SUI
treasury, non-transferable License, GiftProduct and GiftReceipt. Character transfer below
is retained for the old direct-creation client, not for market sales.
See [market architecture and trust boundaries](../../docs/MARKET_PIVOT.md).
Use this same CLI version for reproducible validation. Publication emitted `Move.lock`;
it is checked in with portable forward-slash dependency paths and was retested.

```powershell
.local-tools/sui-1.79.0/sui.exe move test --path contracts/everyday
.local-tools/sui-1.79.0/sui.exe move build --path contracts/everyday
```

`Character` is address owned and externally transferable. Mutation takes an owned
object plus expected revision. `UserVault` lacks `store`, has no transfer function,
and approves only its exact 32-byte object ID and original owner for Seal. It may
remain readable after a Character transfer; private history is never part of the
Character object. Multiple vaults per wallet are supported by the client.

The contract validates reference sizes, not Walrus certification or storage expiry.
The client checks a publisher certification receipt and downloaded content hash.
This is not an on-chain proof of storage. Publish only after reviewing this trust boundary.

Published to testnet on 2026-09-11. See [verified deployment](deployments/testnet.json)
and the [deployment review](../../infra/DEPLOYMENT_REVIEW.md). Publication, Admin ownership,
UpgradeCap ownership and its package link were verified through the testnet gRPC client.
This does not prove purchase settlement or Walrus/Seal/MemWal integration.

Use `node infra/deploy-testnet.mjs --execute` from the repository root to reverify the
saved publication. It validates source identity and reuses the exact saved transaction;
it does not automatically publish a new package after source changes. This reviewed
entry point replaces the earlier `npm run deploy:testnet` bootstrap for this deployment.
Do not place private keys or recovery phrases in the web env.
