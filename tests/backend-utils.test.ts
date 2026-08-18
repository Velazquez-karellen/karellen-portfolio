import assert from "node:assert/strict";
import test from "node:test";
import {
  boundedInteger,
  canonicalLocale,
  optionalHttpUrl,
  parseAcceptLanguage,
  resolveLocale,
  slugify,
} from "../worker/backend-utils.ts";

test("canonicalLocale normalizes valid locale tags", () => {
  assert.equal(canonicalLocale(" ES-pr "), "es-pr");
  assert.equal(canonicalLocale("not_a_locale"), "");
});

test("Accept-Language honors quality and locale fallback", () => {
  assert.deepEqual(parseAcceptLanguage("fr;q=0.4, en-US;q=0.9, es;q=0.8"), ["en-us", "es", "fr"]);
  assert.equal(resolveLocale(null, "en-US,en;q=0.9", ["es", "en"], "es"), "en");
  assert.equal(resolveLocale("de", null, ["es", "en"], "es"), "es");
});

test("slugify is stable and URL safe", () => {
  assert.equal(slugify("Mi primera fotografía", "abcdef12-0000"), "mi-primera-fotografia-abcdef");
});

test("URLs and pagination values are bounded", () => {
  assert.equal(optionalHttpUrl("javascript:alert(1)"), "");
  assert.equal(optionalHttpUrl("https://example.com/x"), "https://example.com/x");
  assert.equal(boundedInteger("500", 20, 1, 50), 50);
  assert.equal(boundedInteger("bad", 20, 1, 50), 20);
});
