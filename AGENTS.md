# Everyday character marketplace

This folder is one npm monorepo. Read `docs/MARKET_PIVOT.md` before market work.
Keep changes in apps/web, apps/api, packages/contracts, contracts/everyday and infra.
The ignored frontend/backend folders are original independent checkouts; legacy is comparison-only.

Prioritize P0 license purchase, settlement and personal-memory isolation before P1 agent gifts.
Character sales are non-exclusive personal licenses. Never include relationship data in a product.
Use authenticated wallet identity, verify the exact deployed Move package and object ownership,
and fail closed on chain/provider failure. Keep MIST and other u64 values as decimal strings.
Agent spending funds belong in the Move-controlled treasury; ordinary wallet balances bypass its policy.
Do not store signing keys, delegate keys or conversation plaintext in shared contracts or public env.

Use one root lockfile. API DTOs belong in packages/contracts. Do not import API source into the web app.
Run `npm run check:backend` for backend/Move changes and `npm run build` for integration changes.
`npm run test:move` uses SUI_BIN, the local pinned Windows CLI, or sui from PATH.
Document real integration status; mocks and pointer registries do not prove testnet settlement,
Walrus storage, Seal decryption, MemWal memory portability or zkLogin.
