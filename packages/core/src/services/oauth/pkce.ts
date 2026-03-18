import { createHash, randomBytes } from "node:crypto";

export function createPkcePair() {
  const codeVerifier = randomBytes(48).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  return { codeVerifier, codeChallenge, method: "S256" as const };
}
