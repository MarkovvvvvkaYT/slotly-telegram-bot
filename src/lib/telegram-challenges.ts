import { createHash } from "node:crypto";

export function hashChallengeToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function isChallengeExpired(expiresAt: string, now = new Date()) {
  return now.getTime() >= new Date(expiresAt).getTime();
}
