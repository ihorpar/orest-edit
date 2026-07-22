import test from "node:test";
import assert from "node:assert/strict";

import { generateReviewImage } from "../lib/server/review-image-service.ts";

function createJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

test("generateReviewImage rejects empty prompts before calling the provider", async () => {
  let called = false;

  const response = await generateReviewImage(
    { prompt: "   ", apiKey: "gem-test-key" },
    {
      fetchImpl: async () => {
        called = true;
        return createJsonResponse({});
      }
    }
  );

  assert.equal(called, false);
  assert.equal(response.asset, undefined);
  assert.match(response.error ?? "", /Порожній image prompt/i);
});

test("generateReviewImage returns provider error text for non-ok responses", async () => {
  const response = await generateReviewImage(
    { prompt: "Зроби схему.", apiKey: "gem-test-key" },
    {
      fetchImpl: async () =>
        createJsonResponse(
          {
            error: {
              message: "Provider unavailable"
            }
          },
          503
        )
    }
  );

  assert.equal(response.asset, undefined);
  assert.match(response.error ?? "", /Provider unavailable/i);
});

test("generateReviewImage returns a timeout-style message on abort errors", async () => {
  const response = await generateReviewImage(
    { prompt: "Зроби інфографіку.", apiKey: "gem-test-key" },
    {
      fetchImpl: async () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        throw error;
      }
    }
  );

  assert.equal(response.asset, undefined);
  assert.match(response.error ?? "", /не відповів вчасно/i);
});

test("generateReviewImage sends generationConfig with responseModalities and imageConfig", async () => {
  let requestBody: Record<string, unknown> | undefined;

  const response = await generateReviewImage(
    { prompt: "Намалюй мінімалістичну схему HDL/LDL.", apiKey: "gem-test-key" },
    {
      fetchImpl: async (_input, init) => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;

        return createJsonResponse({
          candidates: [
            {
              content: {
                parts: [
                  {
                    inlineData: {
                      mimeType: "image/png",
                      data: "ZmFrZS1pbWFnZQ=="
                    }
                  }
                ]
              }
            }
          ]
        });
      }
    }
  );

  assert.ok(requestBody);
  assert.equal(typeof requestBody.responseModalities, "undefined");
  assert.equal(typeof requestBody.imageConfig, "undefined");
  assert.deepEqual(requestBody.generationConfig, {
    responseModalities: ["IMAGE"],
    imageConfig: {
      aspectRatio: "4:3",
      imageSize: "1K"
    },
    thinkingConfig: {
      thinkingLevel: "minimal"
    }
  });
  assert.ok(response.asset);
  assert.equal(response.asset?.source.kind, "data_url");
  assert.match(response.asset?.source.kind === "data_url" ? response.asset.source.dataUrl : "", /^data:image\/png;base64,/);
});

test("generateReviewImage uses quality profile for 2K flash-image requests", async () => {
  let requestedUrl = "";
  let requestBody: Record<string, unknown> | undefined;

  const response = await generateReviewImage(
    { prompt: "Намалюй детальну інфографіку.", apiKey: "gem-test-key", imageQuality: "quality" },
    {
      fetchImpl: async (input, init) => {
        requestedUrl = String(input);
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;

        return createJsonResponse({
          candidates: [
            {
              content: {
                parts: [
                  {
                    inlineData: {
                      mimeType: "image/png",
                      data: "ZmFrZS1pbWFnZQ=="
                    }
                  }
                ]
              }
            }
          ]
        });
      }
    }
  );

  assert.match(requestedUrl, /gemini-3\.1-flash-image:generateContent/);
  assert.deepEqual(requestBody?.generationConfig, {
    responseModalities: ["IMAGE"],
    imageConfig: {
      aspectRatio: "4:3",
      imageSize: "2K"
    }
  });
  assert.equal(response.modelId, "gemini-3.1-flash-image");
  assert.ok(response.asset);
});

test("generateReviewImage returns diagnostic error when Gemini returns no inline image bytes", async () => {
  const response = await generateReviewImage(
    { prompt: "Зроби інфографіку.", apiKey: "gem-test-key" },
    {
      fetchImpl: async () =>
        createJsonResponse({
          promptFeedback: {
            blockReason: "SAFETY"
          },
          candidates: [
            {
              finishReason: "SAFETY",
              content: {
                parts: [{ text: "Image generation blocked by safety filters." }]
              }
            }
          ]
        })
    }
  );

  assert.equal(response.asset, undefined);
  assert.match(response.error ?? "", /Gemini не повернув зображення у відповіді/i);
  assert.match(response.error ?? "", /blockReason=SAFETY/i);
  assert.match(response.error ?? "", /finishReason=SAFETY/i);
  assert.match(response.error ?? "", /Image generation blocked by safety filters\./i);
});
