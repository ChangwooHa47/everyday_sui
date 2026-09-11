// Read-only connectivity probe. It never loads wallet keys or submits transactions.
import { SuiGrpcClient } from '@mysten/sui/grpc';
const client = new SuiGrpcClient({ network: 'testnet', baseUrl: 'https://fullnode.testnet.sui.io:443' });
const checks = await Promise.allSettled([
  client.getObject({ objectId: '0x6', signal: AbortSignal.timeout(15000) }).then(r => ({ sui: r.object.type })),
  fetch('https://relayer-staging.memory.walrus.xyz/health', { signal: AbortSignal.timeout(15000) }).then(async r => ({ memwalStatus: r.status, reachable: r.ok })),
  fetch('https://relayer-staging.memory.walrus.xyz/config', { signal: AbortSignal.timeout(15000) }).then(async r => {
    if (!r.ok) return { memwalConfigStatus: r.status };
    const c = await r.json();
    if (c.network !== 'testnet' || !/^0x[0-9a-f]{64}$/.test(c.packageId)) throw Error('MemWal deployment is not the expected testnet configuration');
    const response = await fetch('https://graphql.testnet.sui.io/graphql', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'query($type: String!) { objects(filter: {type: $type}) { nodes { address } } }', variables: { type: `${c.packageId}::account::AccountRegistry` } }), signal: AbortSignal.timeout(15000) });
    const graph = await response.json(); const registries = graph.data?.objects?.nodes ?? [];
    return { packageId: c.packageId, registryId: registries.length === 1 ? registries[0].address : null, network: c.network };
  }),
]);
for (const result of checks) console.log(result.status === 'fulfilled' ? result.value : { error: result.reason.message });
