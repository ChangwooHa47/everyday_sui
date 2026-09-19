# Testnet wallet handoff hotfix — 2026-09-19

## Follow-up: Phantom login restored

Phantom and Sui-mainnet accounts are allowed to log in. Authentication uses only
personal-message signing on a network the account supports (mainnet for Phantom).
The server challenge remains bound to this application's testnet audience and
continues to verify the same wallet address. Every asset transaction still
explicitly targets testnet and retains the transaction compatibility guard.
The initial login filter described below has been superseded by this follow-up.
Slush troubleshooting is a separate next step.

## Evidence and scope

- The user-selected Chrome transaction notification belongs to Phantom, not Slush. Extension contents could not be inspected because browser policy blocks extension URLs. No wallet approval or purchase was performed.
- Phantom's [supported test networks](https://help.phantom.com/articles/5997313271699) do not include Sui. Its [Sui integration documentation](https://docs.phantom.com/sui/sending-a-transaction) also announces deprecation on 2026-09-24. A provider accepting a testnet chain argument is not enough to establish compatibility.
- `node infra/probe-purchase.mjs` read the reported listing `0xdd86…28dc` on testnet and simulated `market::purchase` with gas selection using the existing public deployment account. Active/published, price 10000000 MIST, successful effects, fully built transaction. This is not a simulation of the user's exact account or a real settlement.
- The app handed unresolved transactions to wallets. It did not surface gas/build failures before the popup, and allowed Phantom to authenticate into a testnet-only application.

## Changes and review

- Filter unsupported wallets at login; repeat wallet/account network validation at login and every transaction handoff, including restored sessions. Existing sessions are not silently migrated to a different wallet identity.
- Resolve objects, select gas and build transaction bytes using the application's testnet client before wallet handoff. Preserve the supplied sender; reject mismatches and account/wallet changes during preparation.
- Apply the shared preparation to character licenses, internal/external NFTs, photo payment, publication and memory setup.
- Prepare NFT purchases before storing the durable pending marker. Keep ambiguous wallet outcomes blocked; do not erase previous uncertain purchases or treat RPC failures as success.
- No changes to deployed contracts, provider settings, chain state or existing relationship data. The isolated hotfix excludes incomplete character-gift work in the original checkout.

Actual end-to-end wallet approval still requires the user to connect a Sui-testnet-compatible wallet with testnet SUI. The contract simulation does not establish the user's balance or diagnose every possible wallet failure.

## Validation

- Full contracts/API/web production build passed.
- Web unit tests: 26 passed, including unsupported wallet/account networks, sender mismatch, wallet change during build, gas errors and no pending marker after preflight failure.
- Focused Playwright test: supported-wallet visibility and unsupported-wallet filtering passed.
- Move tests: 26 passed. No contract modifications are part of this hotfix.
