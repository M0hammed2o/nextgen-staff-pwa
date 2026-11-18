/**
 * At-rest encryption for queued sale payloads (Web Crypto AES-GCM).
 *
 * THREAT MODEL (be honest about what this does and does not do):
 *  - The key is generated per device with extractable:false and stored in the
 *    same IndexedDB database as the ciphertext. Script (and the browser
 *    itself) can USE the key but cannot read its bytes.
 *  - This protects against casual copying of the profile/IndexedDB files
 *    (the ciphertext is useless without the live key object, which does not
 *    export) and against plaintext customer data sitting in a disk dump or
 *    backup of the storage directory.
 *  - It does NOT protect against a compromised device or browser profile:
 *    anyone who can run script as this origin (XSS, a malicious extension,
 *    someone logged into the OS account with the browser open) can ask the
 *    key to decrypt. It is not a substitute for device lock/OS disk
 *    encryption, and it is not authentication.
 *  - If Web Crypto is unavailable (non-secure context), we REFUSE to queue
 *    rather than silently fall back to plaintext.
 */
import type { EncryptedBlob } from "./types";
import { OfflineQueueError } from "./types";
import type { OfflineStore } from "./store";

const KEY_META = "device_key";

function subtle(): SubtleCrypto {
  const s = typeof crypto !== "undefined" ? crypto.subtle : undefined;
  if (!s) throw new OfflineQueueError("Secure storage is not available on this device, so offline sales cannot be saved.", "NO_CRYPTO");
  return s;
}

export async function getOrCreateDeviceKey(store: OfflineStore): Promise<CryptoKey> {
  const existing = await store.getMeta<CryptoKey>(KEY_META);
  if (existing) return existing;
  const key = await subtle().generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  await store.setMeta(KEY_META, key);
  return key;
}

export async function deleteDeviceKey(store: OfflineStore): Promise<void> {
  await store.deleteMeta(KEY_META);
}

export async function encryptJson(key: CryptoKey, value: unknown): Promise<EncryptedBlob> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify(value));
  const ct = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv }, key, plain));
  return { iv, ct };
}

export async function decryptJson<T>(key: CryptoKey, blob: EncryptedBlob): Promise<T> {
  const plain = await subtle().decrypt({ name: "AES-GCM", iv: blob.iv as BufferSource }, key, blob.ct as BufferSource);
  return JSON.parse(new TextDecoder().decode(plain)) as T;
}
