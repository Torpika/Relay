import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

interface EncryptedValue {
  iv: string;
  ciphertext: string;
  authTag: string;
}

export interface CredentialContext {
  workspaceId: string;
  connectionId: string;
}

export interface CredentialEnvelope {
  algorithm: "aes-256-gcm-envelope-v1";
  keyVersion: string;
  context: string;
  wrappedKey: EncryptedValue;
  credential: EncryptedValue;
}

function decodeKey(encodedKey: string, label: string): Buffer {
  const key = Buffer.from(encodedKey, "base64");

  if (key.length !== 32) {
    throw new Error(`${label} must be a base64-encoded 32-byte key`);
  }

  return key;
}

function developmentKey(): Buffer {
  const secret = process.env.DEV_CREDENTIAL_ENCRYPTION_SECRET ?? process.env.SESSION_SECRET;

  if (!secret && process.env.NODE_ENV !== "test") {
    throw new Error("CREDENTIAL_MASTER_KEY is required outside tests");
  }

  return createHash("sha256").update(secret ?? "relay-test-credential-key").digest();
}

function credentialKeys(): { primaryVersion: string; keys: Map<string, Buffer> } {
  const primaryVersion = process.env.CREDENTIAL_MASTER_KEY_VERSION ?? "v1";
  const keys = new Map<string, Buffer>();
  const primaryKey = process.env.CREDENTIAL_MASTER_KEY;

  if (primaryKey) {
    keys.set(primaryVersion, decodeKey(primaryKey, "CREDENTIAL_MASTER_KEY"));
  } else if (process.env.NODE_ENV !== "production") {
    keys.set(primaryVersion, developmentKey());
  } else {
    throw new Error("CREDENTIAL_MASTER_KEY is required in production");
  }

  if (process.env.CREDENTIAL_MASTER_KEYRING) {
    const parsed = JSON.parse(process.env.CREDENTIAL_MASTER_KEYRING) as Record<string, string>;

    for (const [version, encodedKey] of Object.entries(parsed)) {
      keys.set(version, decodeKey(encodedKey, `CREDENTIAL_MASTER_KEYRING.${version}`));
    }
  }

  return { primaryVersion, keys };
}

function contextValue(context: CredentialContext): string {
  return `${context.workspaceId}:${context.connectionId}`;
}

function encryptValue(value: Buffer, key: Buffer, associatedData: string): EncryptedValue {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(associatedData, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(value), cipher.final()]);

  return {
    iv: iv.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64")
  };
}

function decryptValue(value: EncryptedValue, key: Buffer, associatedData: string): Buffer {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(value.iv, "base64"));
  decipher.setAAD(Buffer.from(associatedData, "utf8"));
  decipher.setAuthTag(Buffer.from(value.authTag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(value.ciphertext, "base64")), decipher.final()]);
}

export function encryptCredential(credential: string, context: CredentialContext): CredentialEnvelope {
  const { primaryVersion, keys } = credentialKeys();
  const masterKey = keys.get(primaryVersion);

  if (!masterKey) {
    throw new Error(`Credential key ${primaryVersion} is not configured`);
  }

  const envelopeContext = contextValue(context);
  const dataKey = randomBytes(32);

  return {
    algorithm: "aes-256-gcm-envelope-v1",
    keyVersion: primaryVersion,
    context: envelopeContext,
    wrappedKey: encryptValue(dataKey, masterKey, `relay:credential-key:${envelopeContext}`),
    credential: encryptValue(Buffer.from(credential, "utf8"), dataKey, `relay:credential:${envelopeContext}`)
  };
}

export function decryptCredential(envelope: CredentialEnvelope, context: CredentialContext): string {
  if (envelope.algorithm !== "aes-256-gcm-envelope-v1") {
    throw new Error(`Unsupported credential algorithm: ${envelope.algorithm}`);
  }

  const expectedContext = contextValue(context);

  if (envelope.context !== expectedContext) {
    throw new Error("Credential envelope does not belong to this provider connection");
  }

  const masterKey = credentialKeys().keys.get(envelope.keyVersion);

  if (!masterKey) {
    throw new Error(`Credential key ${envelope.keyVersion} is not configured`);
  }

  const dataKey = decryptValue(
    envelope.wrappedKey,
    masterKey,
    `relay:credential-key:${expectedContext}`
  );
  return decryptValue(
    envelope.credential,
    dataKey,
    `relay:credential:${expectedContext}`
  ).toString("utf8");
}

export function maskCredential(credential: string): string {
  return `••••••••${credential.length > 8 ? credential.slice(-4) : ""}`;
}
