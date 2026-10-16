import { describe, expect, test } from "bun:test";
import {
  authorize,
  extractPresentedKey,
  MasterKeyMissingError,
  requireMasterKey,
} from "../src/auth.ts";

describe("requireMasterKey", () => {
  test("throws when MASTER_API_KEY is missing", () => {
    expect(() => requireMasterKey({})).toThrow(MasterKeyMissingError);
  });

  test("returns the key when set", () => {
    expect(requireMasterKey({ MASTER_API_KEY: "test-master" })).toBe("test-master");
  });
});

describe("extractPresentedKey", () => {
  test("reads Bearer token", () => {
    const headers = new Headers({ authorization: "Bearer abc" });
    expect(extractPresentedKey(headers)).toBe("abc");
  });

  test("accepts a lowercase bearer scheme", () => {
    const headers = new Headers({ authorization: "bearer abc" });
    expect(extractPresentedKey(headers)).toBe("abc");
  });

  test("accepts an uppercase bearer scheme", () => {
    const headers = new Headers({ authorization: "BEARER abc" });
    expect(extractPresentedKey(headers)).toBe("abc");
  });

  test("accepts multiple spaces or a tab after the scheme", () => {
    const headers = new Headers({ authorization: "Bearer \tabc" });
    expect(extractPresentedKey(headers)).toBe("abc");
  });

  test("rejects a token glued to the scheme", () => {
    const headers = new Headers({ authorization: "bearerx abc" });
    expect(extractPresentedKey(headers)).toBeUndefined();
  });

  test("rejects a bare Bearer with no token", () => {
    const headers = new Headers({ authorization: "Bearer" });
    expect(extractPresentedKey(headers)).toBeUndefined();
  });

  test("reads x-api-key", () => {
    const headers = new Headers({ "x-api-key": "abc" });
    expect(extractPresentedKey(headers)).toBe("abc");
  });

  test("falls back to x-api-key when Authorization is not a Bearer scheme", () => {
    const headers = new Headers({ authorization: "Basic abc", "x-api-key": "abc" });
    expect(extractPresentedKey(headers)).toBe("abc");
  });

  test("returns undefined when neither header is present", () => {
    expect(extractPresentedKey(new Headers())).toBeUndefined();
  });
});

describe("authorize", () => {
  test("rejects missing key", () => {
    expect(authorize(undefined, "secret")).toEqual({ ok: false, status: 401 });
  });

  test("rejects wrong key", () => {
    expect(authorize("nope", "secret")).toEqual({ ok: false, status: 401 });
  });

  test("accepts matching master key", () => {
    expect(authorize("secret", "secret")).toEqual({ ok: true });
  });
});
