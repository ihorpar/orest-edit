import assert from "node:assert/strict";
import test from "node:test";
import { getApiErrors, resolveQueryLocale, resolveRequestLocale } from "../lib/i18n/api-errors.ts";

test("getApiErrors returns English validation messages", () => {
  const errors = getApiErrors("en");

  assert.equal(errors.invalidRequestBody, "Invalid request body.");
  assert.equal(errors.jobIdRequired, "jobId is required.");
  assert.equal(errors.reviewResultInvalid, "The review run finished without a valid result. Run the step again.");
  assert.match(errors.invalidSelectionRange, /Invalid selection\.range/i);
});

test("resolveRequestLocale reads locale from request body", () => {
  assert.equal(resolveRequestLocale({ locale: "en" }), "en");
  assert.equal(resolveRequestLocale({ locale: "uk" }), "uk");
  assert.equal(resolveRequestLocale({ locale: "fr" }), "uk");
  assert.equal(resolveRequestLocale(null), "uk");
});

test("resolveQueryLocale reads locale from query string", () => {
  assert.equal(resolveQueryLocale(new URLSearchParams("locale=en")), "en");
  assert.equal(resolveQueryLocale(new URLSearchParams("locale=uk")), "uk");
  assert.equal(resolveQueryLocale(new URLSearchParams("locale=fr")), "uk");
  assert.equal(resolveQueryLocale(new URLSearchParams()), "uk");
});
