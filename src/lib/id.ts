import { randomBytes } from "node:crypto";

/** ID pendek, aman untuk URL. */
export function createId(): string {
  return randomBytes(12).toString("base64url");
}

export function randomSecret(bytes = 24): string {
  return randomBytes(bytes).toString("hex");
}
