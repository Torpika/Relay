import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  decryptCredential,
  encryptCredential,
  maskCredential,
  type CredentialContext
} from "@/server/security/credentials";

const context: CredentialContext = {
  workspaceId: "workspace-a",
  connectionId: "connection-a"
};

const environmentKeys = [
  "CREDENTIAL_MASTER_KEY",
  "CREDENTIAL_MASTER_KEY_VERSION",
  "CREDENTIAL_MASTER_KEYRING",
  "DEV_CREDENTIAL_ENCRYPTION_SECRET",
  "SESSION_SECRET"
] as const;

describe("credential envelopes", () => {
  const originalEnvironment = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const key of environmentKeys) {
      originalEnvironment.set(key, process.env[key]);
      delete process.env[key];
    }
    vi.stubEnv("NODE_ENV", "test");
    process.env.CREDENTIAL_MASTER_KEY = Buffer.alloc(32, 7).toString("base64");
    process.env.CREDENTIAL_MASTER_KEY_VERSION = "key-1";
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    for (const key of environmentKeys) {
      const value = originalEnvironment.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it("round trips a credential without storing plaintext", () => {
    const envelope = encryptCredential("secret-provider-key", context);

    expect(JSON.stringify(envelope)).not.toContain("secret-provider-key");
    expect(decryptCredential(envelope, context)).toBe("secret-provider-key");
  });

  it("uses a new data key and nonce for every envelope", () => {
    const first = encryptCredential("same-secret", context);
    const second = encryptCredential("same-secret", context);

    expect(first.wrappedKey.ciphertext).not.toBe(second.wrappedKey.ciphertext);
    expect(first.credential.ciphertext).not.toBe(second.credential.ciphertext);
  });

  it("binds the envelope to its tenant and connection", () => {
    const envelope = encryptCredential("secret-provider-key", context);

    expect(() => decryptCredential(envelope, { ...context, connectionId: "connection-b" })).toThrow(
      "does not belong"
    );
  });

  it("decrypts old envelopes through the keyring after rotation", () => {
    const oldKey = process.env.CREDENTIAL_MASTER_KEY as string;
    const envelope = encryptCredential("rotating-secret", context);
    process.env.CREDENTIAL_MASTER_KEY = Buffer.alloc(32, 9).toString("base64");
    process.env.CREDENTIAL_MASTER_KEY_VERSION = "key-2";
    process.env.CREDENTIAL_MASTER_KEYRING = JSON.stringify({ "key-1": oldKey });

    expect(decryptCredential(envelope, context)).toBe("rotating-secret");
  });

  it("does not reveal short credentials in summaries", () => {
    expect(maskCredential("tiny")).toBe("••••••••");
    expect(maskCredential("long-provider-key")).toBe("••••••••-key");
  });
});
