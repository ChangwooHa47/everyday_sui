import type { Reference } from './schema';
import type { Asset } from './chain';
export interface Pending { owner: string; packageId: string; kind: 'public' | 'vault'; bytes: Uint8Array; ref?: Reference; asset?: Asset; digest?: string; }
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('everyday.web3.pending.v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('pending');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function pending(owner: string, pkg: string, action: 'get' | 'put' | 'delete', value?: Pending): Promise<Pending | undefined> {
  const db = await open();
  try {
    return await new Promise((resolve,reject) => {
      const tx = db.transaction('pending', action === 'get' ? 'readonly' : 'readwrite');
      const store = tx.objectStore('pending');
      const key = `testnet:${pkg}:${owner}`;
      const req = action === 'get' ? store.get(key) : action === 'put' ? store.put(value, key) : store.delete(key);
      tx.oncomplete = () => resolve(action === 'get' ? req.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
