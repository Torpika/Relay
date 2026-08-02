import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const credentialKeyFilename = "credential-master-key.enc";

export interface CredentialKeyProtector {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

export function resolveDesktopCredentialMasterKey(
  userDataPath: string,
  legacyKey: string | undefined,
  protector: CredentialKeyProtector
): string {
  const keyPath = join(userDataPath, credentialKeyFilename);

  if (existsSync(keyPath)) {
    return validateCredentialKey(protector.decryptString(Buffer.from(readFileSync(keyPath, "utf8").trim(), "base64")));
  }

  if (!protector.isEncryptionAvailable()) {
    throw new Error("The macOS credential store is unavailable, so Relay cannot protect provider credentials at rest");
  }

  const credentialKey = validateCredentialKey(legacyKey ?? randomBytes(32).toString("base64"));
  mkdirSync(userDataPath, { recursive: true });
  writeFileSync(keyPath, protector.encryptString(credentialKey).toString("base64"), { mode: 0o600 });
  chmodSync(keyPath, 0o600);
  return credentialKey;
}

function validateCredentialKey(value: string): string {
  if (Buffer.from(value, "base64").length !== 32) {
    throw new Error("Relay's credential master key is invalid");
  }

  return value;
}
