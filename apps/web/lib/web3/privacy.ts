import { SealClient, SessionKey } from '@mysten/seal';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Transaction } from '@mysten/sui/transactions';
import { fromHex } from '@mysten/sui/utils';
import { network, rpcUrl, requirePackage, requireSeal, sealServerIds, sealThreshold } from './config';

export type MessageSigner = (message: Uint8Array) => Promise<{ signature: string }>;
// Construct per wallet scope so SDK cached decryption keys cannot survive a wallet change.
export function privacy() {
  requireSeal();
  const pkg = requirePackage();
  const client = new SuiGrpcClient({ network, baseUrl: rpcUrl });
  const sealClient = new SealClient({ suiClient: client,
    serverConfigs: sealServerIds.map(objectId => ({ objectId, weight: 1 })), verifyKeyServers: true,
  });
  let session: SessionKey | undefined;
  return {
    encrypt: async (vaultId: string, data: Uint8Array) => {
      const result = await sealClient.encrypt({ threshold: sealThreshold, packageId: pkg, id: vaultId, data });
      result.key.fill(0);
      return result.encryptedObject;
    },
    decrypt: async (owner: string, vaultId: string, data: Uint8Array, sign: MessageSigner) => {
      if (!session || session.isExpired() || session.getAddress() !== owner) {
        session = await SessionKey.create({ address: owner, packageId: pkg, ttlMin: 10, suiClient: client });
        const signature = await sign(session.getPersonalMessage());
        await session.setPersonalMessageSignature(signature.signature);
      }
      const tx = new Transaction();
      tx.setSender(owner);
      tx.moveCall({ target: `${pkg}::vault::seal_approve`, arguments: [tx.pure.vector('u8', fromHex(vaultId)), tx.object(vaultId)] });
      const txBytes = await tx.build({ client, onlyTransactionKind: true });
      return sealClient.decrypt({ data, sessionKey: session, txBytes });
    },
  };
}
