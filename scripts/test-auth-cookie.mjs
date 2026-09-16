import assert from "node:assert/strict";
import { createAuthCookieValue, isValidAuthCookie } from "../src/lib/auth-cookie.ts";

const tests = [
  {
    name: "valid auth cookie verifies",
    async run() {
      const cookie = await createAuthCookieValue("owner@example.com", "test-secret");

      assert.equal(await isValidAuthCookie(cookie, "test-secret"), true);
    }
  },
  {
    name: "auth cookie fails with wrong secret",
    async run() {
      const cookie = await createAuthCookieValue("owner@example.com", "test-secret");

      assert.equal(await isValidAuthCookie(cookie, "wrong-secret"), false);
    }
  },
  {
    name: "tampered auth cookie is rejected",
    async run() {
      const cookie = await createAuthCookieValue("owner@example.com", "test-secret");
      const tamperedCookie = `${cookie.slice(0, -2)}aa`;

      assert.equal(await isValidAuthCookie(tamperedCookie, "test-secret"), false);
    }
  }
];

for (const test of tests) {
  await test.run();
  console.log(`ok - ${test.name}`);
}
