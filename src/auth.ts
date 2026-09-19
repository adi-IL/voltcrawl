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

export function extractPresentedKey(headers: Headers): string | undefined {
  const authorization = headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length);
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
