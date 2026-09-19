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

  test("reads x-api-key", () => {
    const headers = new Headers({ "x-api-key": "abc" });
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
