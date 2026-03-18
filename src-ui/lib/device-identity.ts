// Device identity: Ed25519 keypair generation, signing, persistence
// Browser version using @noble/curves (pure JS, no WASM)

// @noble/curves v2 exports resolve fine with .js suffix
import { ed25519 } from "@noble/curves/ed25519.js";
import type { DeviceIdentity } from "./types";

const STORAGE_KEY = "clawtachie:device";

// --- Encoding helpers ---

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function base64UrlEncode(bytes: Uint8Array): string {
  // Convert Uint8Array to binary string, then btoa, then URL-safe
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

// --- Device fingerprint: SHA-256(raw_public_key) as hex ---

async function fingerprintPublicKey(publicKey: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", publicKey as unknown as BufferSource);
  return bytesToHex(new Uint8Array(hash));
}

// --- Identity persistence (localStorage) ---

interface StoredDevice {
  version: 1;
  deviceId: string;
  privateKeyHex: string;
  publicKeyHex: string;
  createdAtMs: number;
}

export async function loadOrCreateIdentity(): Promise<DeviceIdentity> {
  // Try to load from localStorage
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const stored = JSON.parse(raw) as StoredDevice;
      if (stored?.version === 1 && stored.privateKeyHex && stored.publicKeyHex) {
        const privateKey = hexToBytes(stored.privateKeyHex);
        const publicKey = hexToBytes(stored.publicKeyHex);
        // Re-derive deviceId to verify integrity
        const deviceId = await fingerprintPublicKey(publicKey);
        return { deviceId, privateKey, publicKey };
      }
    }
  } catch {
    // Corrupted data — regenerate
  }

  // Generate new keypair (v2 API: randomSecretKey, not randomPrivateKey)
  const privateKey = ed25519.utils.randomSecretKey();
  const publicKey = ed25519.getPublicKey(privateKey);
  const deviceId = await fingerprintPublicKey(publicKey);

  // Persist
  const stored: StoredDevice = {
    version: 1,
    deviceId,
    privateKeyHex: bytesToHex(privateKey),
    publicKeyHex: bytesToHex(publicKey),
    createdAtMs: Date.now(),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));

  return { deviceId, privateKey, publicKey };
}

// --- Public key export as base64url (raw 32 bytes) ---

export function publicKeyRawBase64Url(publicKey: Uint8Array): string {
  return base64UrlEncode(publicKey);
}

// --- Ed25519 signing ---

export function signPayload(privateKey: Uint8Array, payload: string): string {
  const messageBytes = new TextEncoder().encode(payload);
  const signature = ed25519.sign(messageBytes, privateKey);
  return base64UrlEncode(signature);
}

// --- Auth payload builder (matches OpenClaw's buildDeviceAuthPayloadV3) ---

// Matches OpenClaw's normalizeDeviceMetadataForAuth: trim + ASCII lowercase
function normalizeMetadata(value?: string | null): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));
}

export function buildAuthPayloadV3(params: {
  deviceId: string;
  clientId: string;
  clientMode: string;
  role: string;
  scopes: string[];
  signedAtMs: number;
  token?: string | null;
  nonce: string;
  platform?: string | null;
  deviceFamily?: string | null;
}): string {
  return [
    "v3",
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    params.scopes.join(","),
    String(params.signedAtMs),
    params.token ?? "",
    params.nonce,
    normalizeMetadata(params.platform),
    normalizeMetadata(params.deviceFamily),
  ].join("|");
}
