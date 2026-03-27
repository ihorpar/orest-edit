import test from "node:test";
import assert from "node:assert/strict";
import { deriveManuscriptRevisionState } from "../lib/editor/manuscript-structure.ts";
import { generateEditorialReview } from "../lib/server/review-service.ts";
import type { EditorialReviewRequest } from "../lib/editor/review-contract.ts";
import type { EditorDocument } from "../lib/editor/document-model.ts";

function createRequest(overrides: Partial<EditorialReviewRequest> = {}): EditorialReviewRequest {
  const document: EditorDocument = {
    version: 2,
    blocks: [
      { id: "h1", type: "heading", level: 2, content: [{ text: "Розділ" }] },
      {
        id: "p1",
        type: "paragraph",
        content: [{ text: "Це дуже довгий абзац, який спеціально зроблено достатньо об'ємним, щоб fallback review запропонував локальне переписування або структурування для читача. ".repeat(4) }]
      }
    ]
  };

  return {
    document,
    revision: deriveManuscriptRevisionState(document),
    provider: "openai",
    modelId: "gpt-5.4",
    changeLevel: 3,
    ...overrides
  };
}

test("generateEditorialReview builds fallback recommendations without API key", async () => {
  const response = await generateEditorialReview(createRequest({ stepId: "clarity" }), {
    readEnvValue: () => null,
    now: () => "2026-03-10T12:00:00.000Z"
  });

  assert.equal(response.usedFallback, true);
  assert.equal(response.stepId, "clarity");
  assert.ok(response.items.length >= 1);
  assert.deepEqual(response.items[0]?.anchor.blockIds, ["p1"]);
  assert.equal(response.diagnostics.blockCount, 2);
});

test("generateEditorialReview fallback enforces step-specific recommendation types", async () => {
  const response = await generateEditorialReview(createRequest({ stepId: "visuals" }), {
    readEnvValue: () => null,
    now: () => "2026-03-10T12:00:00.000Z"
  });

  assert.equal(response.usedFallback, true);
  assert.equal(response.stepId, "visuals");
  assert.equal(response.items.length, 0);
  assert.ok(response.diagnostics.droppedItemCount >= 1);
});

test("generateEditorialReview builds fallback emphasis cards only as rewrite items", async () => {
  const document: EditorDocument = {
    version: 2,
    blocks: [
      {
        id: "p1",
        type: "paragraph",
        content: [{ text: "Шкіра часто першою сигналізує про внутрішній стрес, тому читачеві важливо швидко побачити цю головну тезу без переписування всього абзацу." }]
      }
    ]
  };
  const response = await generateEditorialReview(createRequest({
    document,
    revision: deriveManuscriptRevisionState(document),
    stepId: "emphasis"
  }), {
    readEnvValue: () => null,
    now: () => "2026-03-10T12:00:00.000Z"
  });

  assert.equal(response.usedFallback, true);
  assert.equal(response.stepId, "emphasis");
  assert.ok(response.items.length >= 1);
  assert.ok(response.items.every((item) => item.recommendationType === "rewrite"));
  assert.ok(response.items.every((item) => item.stepId === "emphasis"));
  assert.ok(response.items.every((item) => /"[^"]+"/.test(item.recommendation)));
});

test("generateEditorialReview includes existing bold markers in emphasis prompt", async () => {
  const document: EditorDocument = {
    version: 2,
    blocks: [
      {
        id: "p1",
        type: "paragraph",
        content: [
          { text: "Шкіра " },
          { text: "часто першою показує", bold: true },
          { text: ", як організм реагує на стрес." }
        ]
      }
    ]
  };
  let requestBody = "";

  await generateEditorialReview(
    {
      ...createRequest({
        document,
        revision: deriveManuscriptRevisionState(document),
        stepId: "emphasis",
        apiKey: "test-key"
      })
    },
    {
      fetchImpl: async (_input, init) => {
        requestBody = String(init?.body ?? "");

        return new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              items: []
            })
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      },
      now: () => "2026-03-10T12:00:00.000Z"
    }
  );

  assert.match(requestBody, /\*\*часто першою показує\*\*/);
});

test("generateEditorialReview normalizes provider items to block anchors", async () => {
  const response = await generateEditorialReview(createRequest({ apiKey: "test-key", currentStatus: "cards" }), {
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            items: [
              {
                title: "Розвантажити блок",
                reason: "Абзац перевантажений.",
                recommendation: "Скоротити речення.",
                recommendationType: "rewrite",
                suggestedAction: "rewrite_text",
                priority: "high",
                blockStart: 1,
                blockEnd: 1,
                excerpt: "Це дуже довгий абзац",
                insertionHint: "replace",
                anchorBlockId: "p1",
                calloutKind: null,
                calloutTitle: null,
                calloutPreviewText: null,
                calloutSummary: null,
                calloutPrompt: null,
                visualIntent: null
              }
            ]
          })
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      ),
    now: () => "2026-03-10T12:00:00.000Z"
  });

  assert.equal(response.usedFallback, false);
  assert.equal(response.stepId, "clarity");
  assert.equal(response.items.length, 1);
  assert.deepEqual(response.items[0]?.anchor.blockIds, ["p1"]);
  assert.equal(response.items[0]?.anchor.generationBlockRange.start, 1);
});

test("generateEditorialReview returns provider-native structured fact-check rows", async () => {
  const response = await generateEditorialReview(createRequest({ apiKey: "test-key", stepId: "fact_check" }), {
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            rows: [
              {
                claim: "Кортизол пригнічує регенерацію при хронічному стресі.",
                status: "сумнівно",
                explanation: "Потрібно уточнити силу ефекту та межі застосовності на основі оглядових робіт.",
                sources: []
              }
            ]
          })
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      ),
    now: () => "2026-03-10T12:00:00.000Z"
  });

  assert.equal(response.usedFallback, false);
  assert.equal(response.stepId, "fact_check");
  assert.equal(response.items.length, 0);
  assert.equal(response.factCheckRows?.length, 1);
  assert.equal(response.factCheckRows?.[0]?.status, "сумнівно");
  assert.deepEqual(response.factCheckRows?.[0]?.sources, []);
  assert.equal(
    response.factCheckRows?.[0]?.explanation,
    "Не знайдено надійного зовнішнього джерела. Потрібна ручна перевірка."
  );
});

test("generateEditorialReview treats valid empty provider recommendations as empty result, not fallback", async () => {
  const response = await generateEditorialReview(createRequest({ apiKey: "test-key", stepId: "clarity" }), {
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            items: []
          })
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      ),
    now: () => "2026-03-10T12:00:00.000Z"
  });

  assert.equal(response.usedFallback, false);
  assert.equal(response.stepId, "clarity");
  assert.equal(response.items.length, 0);
  assert.equal(response.error, undefined);
});

test("generateEditorialReview sends grounded Gemini fact-check request via header and resolves sources", async () => {
  let requestedUrl = "";
  let requestHeaders = new Headers();
  const requestedUrls: string[] = [];

  const response = await generateEditorialReview(
    createRequest({
      provider: "gemini",
      modelId: "gemini-3-flash-preview",
      apiKey: "gemini-test-key",
      stepId: "fact_check"
    }),
    {
      fetchImpl: async (input, init) => {
        const url = String(input);
        requestedUrls.push(url);

        if (url.includes(":generateContent")) {
          requestedUrl = url;
          requestHeaders = new Headers(init?.headers);

          return new Response(
            JSON.stringify({
              candidates: [
                {
                  content: {
                    parts: [
                      {
                        text: JSON.stringify({
                          rows: [
                            {
                              claim: "Тестове твердження.",
                              status: "ok",
                              explanation: "Тестове обґрунтування.",
                              sources: []
                            }
                          ]
                        })
                      }
                    ]
                  },
                  groundingMetadata: {
                    groundingChunks: [
                      {
                        web: {
                          uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/test-source",
                          title: "Mayo Clinic"
                        }
                      }
                    ],
                    groundingSupports: [
                      {
                        segment: {
                          text: "Тестове обґрунтування."
                        },
                        groundingChunkIndices: [0]
                      }
                    ]
                  }
                }
              ]
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }

        if (url === "https://vertexaisearch.cloud.google.com/grounding-api-redirect/test-source") {
          return new Response(null, {
            status: 302,
            headers: { location: "https://www.mayoclinic.org/symptoms/clubbing/basics/definition/sym-20050759" }
          });
        }

        throw new Error(`Unexpected URL: ${url}`);
      },
      now: () => "2026-03-10T12:00:00.000Z"
    }
  );

  assert.equal(response.usedFallback, false);
  assert.equal(response.stepId, "fact_check");
  assert.equal(response.factCheckRows?.length, 1);
  assert.equal(response.factCheckRows?.[0]?.sources.length, 1);
  assert.equal(response.factCheckRows?.[0]?.sources[0]?.domain, "mayoclinic.org");
  assert.match(requestedUrl, /generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-3\.1-flash-lite-preview:generateContent$/);
  assert.doesNotMatch(requestedUrl, /\?key=/);
  assert.equal(requestHeaders.get("x-goog-api-key"), "gemini-test-key");
  assert.equal(requestedUrls.some((url) => url.includes("grounding-api-redirect/test-source")), true);
});

test("generateEditorialReview preserves parsed row sources when grounded mapping misses", async () => {
  const response = await generateEditorialReview(
    createRequest({
      provider: "gemini",
      modelId: "gemini-3-flash-preview",
      apiKey: "gemini-test-key",
      stepId: "fact_check"
    }),
    {
      fetchImpl: async (input) => {
        const url = String(input);

        if (url.includes(":generateContent")) {
          return new Response(
            JSON.stringify({
              candidates: [
                {
                  content: {
                    parts: [
                      {
                        text: JSON.stringify({
                          rows: [
                            {
                              claim: "Тестове твердження.",
                              status: "ok",
                              explanation: "Текст пояснення.",
                              sources: [
                                {
                                  title: "Mayo Clinic",
                                  url: "https://www.mayoclinic.org/symptoms/clubbing/basics/definition/sym-20050759",
                                  domain: "mayoclinic.org"
                                }
                              ]
                            }
                          ]
                        })
                      }
                    ]
                  },
                  groundingMetadata: {
                    groundingChunks: [
                      {
                        web: {
                          uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/test-source",
                          title: "Ignored source"
                        }
                      }
                    ],
                    groundingSupports: [
                      {
                        segment: {
                          text: "Несумісний сегмент"
                        },
                        groundingChunkIndices: [0]
                      }
                    ]
                  }
                }
              ]
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }

        if (url === "https://vertexaisearch.cloud.google.com/grounding-api-redirect/test-source") {
          return new Response(null, {
            status: 302,
            headers: { location: "https://www.clevelandclinic.org/health/symptoms/24474-clubbed-fingers" }
          });
        }

        throw new Error(`Unexpected URL: ${url}`);
      },
      now: () => "2026-03-10T12:00:00.000Z"
    }
  );

  assert.equal(response.usedFallback, false);
  assert.equal(response.factCheckRows?.length, 1);
  assert.equal(response.factCheckRows?.[0]?.sources.length, 1);
  assert.equal(response.factCheckRows?.[0]?.sources[0]?.domain, "mayoclinic.org");
});

test("generateEditorialReview drops grounded sources outside trusted domain allowlist", async () => {
  const response = await generateEditorialReview(
    createRequest({
      provider: "gemini",
      modelId: "gemini-3.1-pro-preview",
      apiKey: "gemini-test-key",
      stepId: "fact_check"
    }),
    {
      fetchImpl: async (input) => {
        const url = String(input);

        if (url.includes(":generateContent")) {
          return new Response(
            JSON.stringify({
              candidates: [
                {
                  content: {
                    parts: [
                      {
                        text: JSON.stringify({
                          rows: [
                            {
                              claim: "Тестове твердження.",
                              status: "ok",
                              explanation: "Тестове обґрунтування.",
                              sources: []
                            }
                          ]
                        })
                      }
                    ]
                  },
                  groundingMetadata: {
                    groundingChunks: [
                      {
                        web: {
                          uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/untrusted",
                          title: "Untrusted Source"
                        }
                      },
                      {
                        web: {
                          uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/trusted",
                          title: "Mayo Clinic"
                        }
                      }
                    ],
                    groundingSupports: [
                      {
                        segment: {
                          text: "Тестове обґрунтування."
                        },
                        groundingChunkIndices: [0, 1]
                      }
                    ]
                  }
                }
              ]
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }

        if (url === "https://vertexaisearch.cloud.google.com/grounding-api-redirect/untrusted") {
          return new Response(null, {
            status: 302,
            headers: { location: "https://ujdvc.com.ua/article" }
          });
        }

        if (url === "https://vertexaisearch.cloud.google.com/grounding-api-redirect/trusted") {
          return new Response(null, {
            status: 302,
            headers: { location: "https://www.mayoclinic.org/symptoms/clubbing/basics/definition/sym-20050759" }
          });
        }

        throw new Error(`Unexpected URL: ${url}`);
      },
      now: () => "2026-03-10T12:00:00.000Z"
    }
  );

  assert.equal(response.usedFallback, false);
  assert.equal(response.factCheckRows?.length, 1);
  assert.equal(response.factCheckRows?.[0]?.sources.length, 1);
  assert.equal(response.factCheckRows?.[0]?.sources[0]?.domain, "mayoclinic.org");
});

test("generateEditorialReview replaces unsupported explanations when suspicious rows have no trusted sources", async () => {
  const response = await generateEditorialReview(
    createRequest({
      provider: "gemini",
      modelId: "gemini-3.1-pro-preview",
      apiKey: "gemini-test-key",
      stepId: "fact_check"
    }),
    {
      fetchImpl: async (input) => {
        const url = String(input);

        if (url.includes(":generateContent")) {
          return new Response(
            JSON.stringify({
              candidates: [
                {
                  content: {
                    parts: [
                      {
                        text: JSON.stringify({
                          rows: [
                            {
                              claim: "Тестове твердження.",
                              status: "сумнівно",
                              explanation: "Старе впевнене пояснення без джерела.",
                              sources: []
                            }
                          ]
                        })
                      }
                    ]
                  },
                  groundingMetadata: {
                    groundingChunks: [
                      {
                        web: {
                          uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/untrusted-only",
                          title: "Untrusted Source"
                        }
                      }
                    ],
                    groundingSupports: [
                      {
                        segment: {
                          text: "Старе впевнене пояснення без джерела."
                        },
                        groundingChunkIndices: [0]
                      }
                    ]
                  }
                }
              ]
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }

        if (url === "https://vertexaisearch.cloud.google.com/grounding-api-redirect/untrusted-only") {
          return new Response(null, {
            status: 302,
            headers: { location: "https://health-ua.com/article" }
          });
        }

        throw new Error(`Unexpected URL: ${url}`);
      },
      now: () => "2026-03-10T12:00:00.000Z"
    }
  );

  assert.equal(response.usedFallback, false);
  assert.equal(response.factCheckRows?.length, 1);
  assert.equal(response.factCheckRows?.[0]?.sources.length, 0);
  assert.equal(
    response.factCheckRows?.[0]?.explanation,
    "Не знайдено надійного зовнішнього джерела. Потрібна ручна перевірка."
  );
});

test("generateEditorialReview filters model-provided row sources by URL domain allowlist", async () => {
  const response = await generateEditorialReview(
    createRequest({
      provider: "gemini",
      modelId: "gemini-3.1-flash-lite-preview",
      apiKey: "gemini-test-key",
      stepId: "fact_check"
    }),
    {
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        rows: [
                          {
                            claim: "Тестове твердження.",
                            status: "сумнівно",
                            explanation: "Тестове обґрунтування.",
                            sources: [
                              {
                                title: "Сумнівний блог",
                                url: "https://health-ua.com/article",
                                domain: "mayoclinic.org"
                              },
                              {
                                title: "Mayo Clinic",
                                url: "https://www.mayoclinic.org/symptoms/clubbing/basics/definition/sym-20050759",
                                domain: "random.invalid"
                              }
                            ]
                          }
                        ]
                      })
                    }
                  ]
                },
                groundingMetadata: {}
              }
            ]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        ),
      now: () => "2026-03-10T12:00:00.000Z"
    }
  );

  assert.equal(response.usedFallback, false);
  assert.equal(response.factCheckRows?.length, 1);
  assert.equal(response.factCheckRows?.[0]?.sources.length, 1);
  assert.equal(response.factCheckRows?.[0]?.sources[0]?.domain, "mayoclinic.org");
});

test("generateEditorialReview Gemini schema does not force nullable card fields", async () => {
  let schemaRequired: string[] = [];

  const response = await generateEditorialReview(
    createRequest({
      provider: "gemini",
      modelId: "gemini-2.5-flash",
      apiKey: "gemini-test-key",
      stepId: "clarity"
    }),
    {
      fetchImpl: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as {
          generationConfig?: { responseSchema?: { properties?: { items?: { items?: { required?: string[] } } } } };
        };
        schemaRequired = body.generationConfig?.responseSchema?.properties?.items?.items?.required ?? [];

        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        items: []
                      })
                    }
                  ]
                }
              }
            ]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      },
      now: () => "2026-03-10T12:00:00.000Z"
    }
  );

  assert.equal(response.usedFallback, false);
  assert.deepEqual(schemaRequired.includes("anchorBlockId"), false);
  assert.deepEqual(schemaRequired.includes("calloutKind"), false);
  assert.deepEqual(schemaRequired.includes("calloutTitle"), false);
  assert.deepEqual(schemaRequired.includes("calloutPreviewText"), false);
  assert.deepEqual(schemaRequired.includes("calloutSummary"), false);
  assert.deepEqual(schemaRequired.includes("calloutPrompt"), false);
  assert.deepEqual(schemaRequired.includes("visualIntent"), false);
});

test("generateEditorialReview injects clarity-specific anti-disclaimer guardrails into provider prompt", async () => {
  let requestBody: Record<string, unknown> | undefined;

  const response = await generateEditorialReview(
    createRequest({
      apiKey: "test-key",
      stepId: "clarity"
    }),
    {
      fetchImpl: async (_input, init) => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;

        return new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              items: []
            })
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      },
      now: () => "2026-03-10T12:00:00.000Z"
    }
  );

  assert.equal(response.usedFallback, false);
  assert.ok(requestBody);
  assert.match(String(requestBody?.instructions ?? ""), /не пропонуй шаблонних застережень про консультацію з лікарем/i);
  assert.match(String(requestBody?.instructions ?? ""), /для кроку «ясність» пропонуй лише мовні й локально-структурні правки/i);
  assert.match(String(requestBody?.instructions ?? ""), /пунктуація списків:/i);
  assert.match(String(requestBody?.instructions ?? ""), /починається з малої літери/i);
  assert.match(String(requestBody?.input ?? ""), /збережи короткі окремі пункти/i);
});
