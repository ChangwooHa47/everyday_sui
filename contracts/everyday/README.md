# Everyday Move package

Validated with Sui CLI `testnet-v1.79.0`, which resolves implicit Sui framework dependencies.
The marketplace uses `market.move`: Creator, shared Listing with a policy-controlled SUI
treasury, non-transferable License, GiftProduct and GiftReceipt. Character transfer below
is retained for the old direct-creation client, not for market sales.
See [market architecture and trust boundaries](../../docs/MARKET_PIVOT.md).
Use this same CLI version for reproducible validation; this CLI did not emit a `Move.lock`.

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

No package has been published by this implementation. After reviewing the code,
use a dedicated funded testnet wallet, run `sui client publish --gas-budget 200000000`,
from this directory, save package/UpgradeCap IDs privately, and put the package ID
in `apps/web/.env.local`. Do not place private keys or recovery phrases in the web env.
