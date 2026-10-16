import { timingSafeEqual } from "node:crypto";

export class MasterKeyMissingError extends Error {
  constructor() {
    super("MASTER_API_KEY is not set");
    this.name = "MasterKeyMissingError";
  }
}

export type AuthResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly status: 401 };

export function requireMasterKey(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const key = env.MASTER_API_KEY;
  if (key === undefined || key.length === 0) {
    throw new MasterKeyMissingError();
  }
  return key;
}

/**
 * RFC 7235 makes the auth scheme case-insensitive, and one or more spaces or
 * tabs may separate it from the token. The token itself is returned unchanged.
 */
const BEARER_PATTERN = /^Bearer[ \t]+(.+)$/i;

export function extractPresentedKey(headers: Headers): string | undefined {
  const authorization = headers.get("authorization");
  if (authorization !== null) {
    const match = BEARER_PATTERN.exec(authorization);
    if (match !== null) {
      return match[1];
    }
  }
  const apiKey = headers.get("x-api-key");
  if (apiKey !== null && apiKey.length > 0) {
    return apiKey;
  }
  return undefined;
}

export function authorize(
  presented: string | undefined,
  master: string,
): AuthResult {
  if (presented === undefined || presented.length === 0) {
    return { ok: false, status: 401 };
  }
  const left = Buffer.from(presented);
  const right = Buffer.from(master);
  if (left.length !== right.length) {
    return { ok: false, status: 401 };
  }
  if (!timingSafeEqual(left, right)) {
    return { ok: false, status: 401 };
  }
  return { ok: true };
}
