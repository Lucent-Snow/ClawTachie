// Device identity: Ed25519 keypair generation, signing, persistence
// Matches OpenClaw's implementation in src/infra/device-identity.ts and src/gateway/device-auth.ts

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { DeviceIdentity, StoredIdentity } from "./types.js";

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const IDENTITY_DIR = path.join(os.homedir(), ".clawtachie");
const IDENTITY_FILE = path.join(IDENTITY_DIR, "device.json");

function base64UrlEncode(buf: Buffer): string {
  return buf.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function derivePublicKeyRaw(publicKeyPem: string): Buffer {
  const key = crypto.createPublicKey(publicKeyPem);
  const spki = key.export({ type: "spki", format: "der" }) as Buffer;
  if (
    spki.length === ED25519_SPKI_PREFIX.length + 32 &&
    spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)
  ) {
    return spki.subarray(ED25519_SPKI_PREFIX.length);
  }
  return spki;
}

function fingerprintPublicKey(publicKeyPem: string): string {
  const raw = derivePublicKeyRaw(publicKeyPem);
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export function loadOrCreateIdentity(): DeviceIdentity {
  try {
    if (fs.existsSync(IDENTITY_FILE)) {
      const raw = fs.readFileSync(IDENTITY_FILE, "utf8");
      const parsed = JSON.parse(raw) as StoredIdentity;
      if (parsed?.version === 1 && parsed.publicKeyPem && parsed.privateKeyPem) {
        const derivedId = fingerprintPublicKey(parsed.publicKeyPem);
        return { deviceId: derivedId, publicKeyPem: parsed.publicKeyPem, privateKeyPem: parsed.privateKeyPem };
      }
    }
  } catch { /* regenerate */ }

  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const deviceId = fingerprintPublicKey(publicKeyPem);

  fs.mkdirSync(IDENTITY_DIR, { recursive: true });
  const stored: StoredIdentity = { version: 1, deviceId, publicKeyPem, privateKeyPem, createdAtMs: Date.now() };
  fs.writeFileSync(IDENTITY_FILE, JSON.stringify(stored, null, 2) + "\n", { mode: 0o600 });

  return { deviceId, publicKeyPem, privateKeyPem };
}

export function publicKeyRawBase64Url(publicKeyPem: string): string {
  return base64UrlEncode(derivePublicKeyRaw(publicKeyPem));
}

export function signPayload(privateKeyPem: string, payload: string): string {
  const key = crypto.createPrivateKey(privateKeyPem);
  const sig = crypto.sign(null, Buffer.from(payload, "utf8"), key);
  return base64UrlEncode(sig);
}

// Matches OpenClaw's normalizeDeviceMetadataForAuth: trim + ASCII lowercase
function normalizeMetadata(value?: string | null): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));
}

// Matches OpenClaw's buildDeviceAuthPayloadV3
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
