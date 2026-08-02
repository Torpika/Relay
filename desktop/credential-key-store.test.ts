import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveDesktopCredentialMasterKey, type CredentialKeyProtector } from "./credential-key-store";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function protector(available = true): CredentialKeyProtector {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (value) => Buffer.from(`protected:${value}`),
    decryptString: (value) => value.toString("utf8").replace(/^protected:/u, "")
  };
}

describe("resolveDesktopCredentialMasterKey", () => {
  it("stores a new key outside the environment file using the platform protector", async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), "relay-key-store-"));
    directories.push(userDataPath);

    const key = resolveDesktopCredentialMasterKey(userDataPath, undefined, protector());
    const storedPath = join(userDataPath, "credential-master-key.enc");

    expect(Buffer.from(key, "base64")).toHaveLength(32);
    expect(existsSync(storedPath)).toBe(true);
    expect(readFileSync(storedPath, "utf8")).not.toContain(key);
    expect(resolveDesktopCredentialMasterKey(userDataPath, undefined, protector())).toBe(key);
  });

  it("migrates a valid legacy environment key into protected storage", async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), "relay-key-migration-"));
    directories.push(userDataPath);
    const legacyKey = Buffer.alloc(32, 9).toString("base64");

    expect(resolveDesktopCredentialMasterKey(userDataPath, legacyKey, protector())).toBe(legacyKey);
  });

  it("refuses to create an unprotected key when the platform credential store is unavailable", async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), "relay-key-unavailable-"));
    directories.push(userDataPath);

    expect(() => resolveDesktopCredentialMasterKey(userDataPath, undefined, protector(false)))
      .toThrow("credential store is unavailable");
  });
});
