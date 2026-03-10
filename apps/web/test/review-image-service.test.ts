import test from "node:test";
import assert from "node:assert/strict";

import { generateReviewImage } from "../lib/server/review-image-service.ts";

function createJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

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
      imageSize: "2K"
    }
  });
  assert.ok(response.asset);
  assert.equal(response.asset?.source.kind, "data_url");
  assert.match(response.asset?.source.kind === "data_url" ? response.asset.source.dataUrl : "", /^data:image\/png;base64,/);
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
