import test from "node:test";
import assert from "node:assert/strict";

import type { EditorDocument } from "../lib/editor/document-model.ts";
import { computeAnchorFingerprint, deriveManuscriptRevisionState } from "../lib/editor/manuscript-structure.ts";
import type {
  EditorialReviewItem,
  EditorialReviewResponse,
  EditorialReviewRunSnapshot
} from "../lib/editor/review-contract.ts";
import { getDefaultEditorSettings } from "../lib/editor/settings.ts";
import { getEditorSettingsStorageKey } from "../lib/i18n/product-locale.ts";
import {
  advanceItemCursor,
  buildProposalRequest,
  buildReviewRunRequest,
  cancelReviewRun,
  interpretProposalReply,
  interpretReviewRunReply,
  pollReviewRun,
  prepareProposal,
  readEditorSettingsReadOnly,
  refreshItemAnchor,
  REVIEW_RUN_CAPABILITY_HEADER,
  startReviewRun,
  validateCompletedReviewResult,
  type ReviewApiMessages
} from "../lib/v2/api.ts";

const messages: ReviewApiMessages = {
  invalid: "INVALID",
  platformTimeout: "PLATFORM",
  pollTimeout: "POLL_TIMEOUT",
  wrongLocale: "WRONG_LOCALE",
  resultInvalid: "RESULT_INVALID",
  proposalInvalid: "PROPOSAL_INVALID",
  network: "NETWORK"
};

const document: EditorDocument = {
  version: 2,
  blocks: [
    { id: "h-1", type: "heading", level: 1, content: [{ text: "Чому кава не замінює сон" }] },
    { id: "p-1", type: "paragraph", content: [{ text: "Кофеїн є конкурентним антагоністом аденозинових рецепторів." }] },
    { id: "p-2", type: "paragraph", content: [{ text: "Втома нікуди не зникає." }] }
  ]
};
const revision = deriveManuscriptRevisionState(document);

function run(overrides: Partial<EditorialReviewRunSnapshot> = {}): EditorialReviewRunSnapshot {
  return {
    runId: "run-1",
    documentRevisionId: revision.documentRevisionId,
    stepId: "clarity",
    locale: "uk",
    provider: "openai",
    modelId: "gpt-6-luna",
    runMode: "replace",
    createdAt: "2026-10-10T10:00:00.000Z",
    status: "running",
    updatedAt: "2026-10-10T10:00:01.000Z",
    pollAfterMs: 1000,
    ...overrides
  };
}

function item(id: string, blockIds: string[] = ["p-1"]): EditorialReviewItem {
  return {
    id,
    reviewSessionId: "session-1",
    documentRevisionId: revision.documentRevisionId,
    changeLevel: 5,
    title: "Спростити термін",
    reason: "«Конкурентний антагоніст» нічого не каже читачеві.",
    recommendation: "Пояснити простими словами.",
    recommendationType: "simplify",
    suggestedAction: "rewrite_text",
    priority: "medium",
    anchor: {
      blockIds,
      generationBlockRange: { start: 1, end: 1 },
      excerpt: "Кофеїн є конкурентним антагоністом",
      fingerprint: computeAnchorFingerprint(document, blockIds)
    },
    insertionPoint: { mode: "replace", anchorBlockId: blockIds[0]! },
    origin: "review",
    stepId: "clarity",
    stepRunId: "step-run-1",
    status: "pending"
  };
}

function result(overrides: Partial<EditorialReviewResponse> = {}): EditorialReviewResponse {
  return {
    reviewSessionId: "session-1",
    stepId: "clarity",
    stepRunId: "step-run-1",
    runMode: "replace",
    items: [item("item-1")],
    providerUsed: "openai",
    usedFallback: false,
    diagnostics: {
      requestId: "req-1",
      reviewSessionId: "session-1",
      stepId: "clarity",
      stepRunId: "step-run-1",
      runMode: "replace",
      requestedProvider: "openai",
      requestedModelId: "gpt-6-luna",
      blockCount: 3,
      changeLevel: 5,
      returnedItemCount: 1,
      returnedFactCheckCount: 0,
      droppedItemCount: 0,
      generatedAt: "2026-10-10T10:00:05.000Z"
    },
    ...overrides
  };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

/* ---------- envelopes ---------- */

test("a run envelope keeps the run, the signed capability, streamed items and the cursor", () => {
  const reply = interpretReviewRunReply(
    JSON.stringify({ kind: "run", run: run(), capability: "signed-cap", items: [item("item-1")], itemCursor: 1, itemCount: 1 }),
    200,
    messages
  );

  assert.equal(reply.kind, "run");
  assert.equal(reply.kind === "run" && reply.capability, "signed-cap");
  assert.equal(reply.kind === "run" && reply.items.length, 1);
  assert.equal(advanceItemCursor(0, reply), 1);
});

test("a run envelope without items is an empty delta and the cursor stays", () => {
  const reply = interpretReviewRunReply(JSON.stringify({ kind: "run", run: run(), capability: "cap" }), 202, messages);
  assert.deepEqual(reply.kind === "run" && reply.items, []);
  assert.equal(advanceItemCursor(4, reply), 4);
});

test("the cursor falls back to counting items when the server reports none", () => {
  const reply = interpretReviewRunReply(JSON.stringify({ kind: "run", run: run(), capability: "cap", items: [item("a"), item("b")] }), 200, messages);
  assert.equal(advanceItemCursor(3, reply), 5);
});

test("a result envelope carries the completed result", () => {
  const reply = interpretReviewRunReply(
    JSON.stringify({ kind: "result", run: run({ status: "completed" }), result: result() }),
    200,
    messages
  );

  assert.equal(reply.kind, "result");
  assert.equal(reply.kind === "result" && reply.result.items[0]!.id, "item-1");
});

test("an error envelope keeps the server's own message, code and partial items", () => {
  const reply = interpretReviewRunReply(
    JSON.stringify({
      kind: "error",
      run: run({ status: "failed" }),
      error: { code: "provider_failed", message: "OpenAI: модель «gpt-nope» не знайдено (404).", retryable: false, providerStatus: 404 },
      items: [item("item-1")],
      itemCursor: 1,
      itemCount: 1
    }),
    502,
    messages
  );

  assert.equal(reply.kind, "error");

  if (reply.kind === "error") {
    assert.equal(reply.code, "provider_failed");
    assert.equal(reply.message, "OpenAI: модель «gpt-nope» не знайдено (404).");
    assert.equal(reply.httpStatus, 502);
    assert.equal(reply.items.length, 1);
    assert.equal(advanceItemCursor(0, reply), 1);
  }
});

test("an internal JavaScript error text from the server is not shown as is", () => {
  const reply = interpretReviewRunReply(
    JSON.stringify({ kind: "error", error: { code: "workflow_failed", message: "Cannot read properties of undefined (reading 'x')", retryable: false } }),
    500,
    messages
  );
  assert.equal(reply.kind === "error" && reply.message, "RESULT_INVALID");
});

test("a non-JSON platform failure is an error, never a result", () => {
  const platform = interpretReviewRunReply("An error occurred with your deployment\n\nFUNCTION_INVOCATION_TIMEOUT", 504, messages);
  assert.equal(platform.kind, "error");
  assert.equal(platform.kind === "error" && platform.code, "platform_failure");
  assert.equal(platform.kind === "error" && platform.message, "PLATFORM (HTTP 504)");

  const html = interpretReviewRunReply("<!doctype html><title>500</title>", 500, messages);
  assert.equal(html.kind === "error" && html.code, "invalid_response");
  assert.equal(html.kind === "error" && html.message, "INVALID (HTTP 500)");
});

test("JSON that is not a run envelope is an error; a plain { error } body keeps its text", () => {
  const shape = interpretReviewRunReply(JSON.stringify({ kind: "run", run: { runId: 1 } }), 200, messages);
  assert.equal(shape.kind === "error" && shape.code, "invalid_response");
  assert.equal(shape.kind === "error" && shape.message, "INVALID");

  const auth = interpretReviewRunReply(JSON.stringify({ error: "Потрібен пароль." }), 401, messages);
  assert.equal(auth.kind === "error" && auth.message, "Потрібен пароль.");
});

test("a completed result must answer the request that started it", () => {
  const expected = run();
  assert.equal(validateCompletedReviewResult(result(), expected, messages), null);
  assert.equal(validateCompletedReviewResult(result({ stepId: "structure" }), expected, messages), "RESULT_INVALID");
  assert.equal(validateCompletedReviewResult(result({ runMode: "preserve" }), expected, messages), "RESULT_INVALID");
  assert.equal(
    validateCompletedReviewResult(result({ items: [{ ...item("item-1"), documentRevisionId: "rev-other" }] }), expected, messages),
    "RESULT_INVALID"
  );
  assert.equal(validateCompletedReviewResult(result(), run({ modelId: "another-model" }), messages), "RESULT_INVALID");
});

/* ---------- proposals ---------- */

const textDiffProposal = {
  id: "proposal-1",
  reviewItemId: "item-1",
  sourceRevisionId: revision.documentRevisionId,
  targetRevisionId: revision.documentRevisionId,
  kind: "text_diff",
  summary: "Спрощено",
  canApplyDirectly: true,
  textDiff: {
    op: "replace_blocks",
    blockIds: ["p-1"],
    oldBlocks: [document.blocks[1]],
    newBlocks: [{ id: "p-1", type: "paragraph", content: [{ text: "Молекула кофеїну займає місце аденозину." }] }],
    reason: "Прибрано термін."
  }
};

test("a text_diff proposal is returned as such, with a no_op warning kept", () => {
  const reply = interpretProposalReply(JSON.stringify({ proposal: textDiffProposal, providerUsed: "openai", usedFallback: false }), 200, messages);
  assert.equal(reply.kind, "text_diff");

  const noOp = interpretProposalReply(
    JSON.stringify({
      proposal: { ...textDiffProposal, textDiff: { ...textDiffProposal.textDiff, warning: { code: "no_op", message: "Текст майже не змінився.", similarity: 0.99 } } }
    }),
    200,
    messages
  );
  assert.equal(noOp.kind === "text_diff" && noOp.proposal.textDiff.warning?.message, "Текст майже не змінився.");
});

test("a provider failure is an error with the server's message even though a proposal object is attached", () => {
  const reply = interpretProposalReply(
    JSON.stringify({
      proposal: { ...textDiffProposal, textDiff: undefined, canApplyDirectly: false },
      providerUsed: "openai",
      usedFallback: false,
      error: "OpenAI повернув помилку 404: модель не знайдено."
    }),
    502,
    messages
  );
  assert.deepEqual(reply, { kind: "error", message: "OpenAI повернув помилку 404: модель не знайдено.", httpStatus: 502 });
});

test("a stale_anchor proposal is reported as stale with its reason", () => {
  const reply = interpretProposalReply(
    JSON.stringify({
      proposal: { ...textDiffProposal, kind: "stale_anchor", textDiff: undefined, canApplyDirectly: false, staleReason: "Фрагмент змінено після рекомендації." },
      error: "Фрагмент змінено після рекомендації."
    }),
    409,
    messages
  );
  assert.equal(reply.kind, "stale_anchor");
  assert.equal(reply.kind === "stale_anchor" && reply.message, "Фрагмент змінено після рекомендації.");
});

test("an unreadable or empty proposal reply is an error", () => {
  assert.deepEqual(interpretProposalReply("<html>Bad gateway</html>", 502, messages), {
    kind: "error",
    message: "PROPOSAL_INVALID (HTTP 502)",
    httpStatus: 502
  });
  assert.equal(interpretProposalReply(JSON.stringify({ error: "Потрібен пароль." }), 401, messages).kind, "error");
  assert.equal(
    interpretProposalReply(JSON.stringify({ proposal: { ...textDiffProposal, textDiff: { ...textDiffProposal.textDiff, newBlocks: [] } } }), 200, messages).kind,
    "error"
  );
  assert.equal(interpretProposalReply(JSON.stringify({ proposal: { ...textDiffProposal, textDiff: undefined } }), 200, messages).kind, "error");
});

test("draft kinds for later passes are passed through", () => {
  const reply = interpretProposalReply(
    JSON.stringify({ proposal: { ...textDiffProposal, kind: "callout_prompt", textDiff: undefined, calloutDraft: { calloutKind: "analogy", calloutDepth: "brief", title: "Т", prompt: "П" } } }),
    200,
    messages
  );
  assert.equal(reply.kind, "draft");
});

/* ---------- requests ---------- */

test("the run request carries the same fields the classic editor sends for a step", () => {
  const settings = { ...getDefaultEditorSettings("uk"), provider: "gemini" as const, modelId: "gemini-test" };
  const request = buildReviewRunRequest({
    document,
    settings,
    locale: "uk",
    stepId: "clarity",
    runMode: "replace",
    rejectedIdeas: [{ blockIds: ["p-2"], recommendationType: "rewrite", recommendation: "Не треба" }]
  });

  assert.equal(request.async, true);
  assert.equal(request.stepId, "clarity");
  assert.equal(request.runMode, "replace");
  assert.equal(request.provider, "gemini");
  assert.equal(request.modelId, "gemini-test");
  assert.equal(request.locale, "uk");
  assert.equal(request.changeLevel, 5);
  assert.equal(request.basePrompt, settings.basePrompt);
  assert.equal(request.cardsPrompt, settings.cardsPrompt);
  assert.equal(request.expertisePrompt, undefined);
  assert.deepEqual(request.workflowStepPrompts, settings.workflowStepPrompts);
  assert.deepEqual(request.revision, { documentRevisionId: revision.documentRevisionId, blockOrder: ["h-1", "p-1", "p-2"], blockFingerprints: {} });
  assert.deepEqual(request.rejectedIdeas, [{ blockIds: ["p-2"], recommendationType: "rewrite", recommendation: "Не треба" }]);
  assert.equal(request.document, document);
  assert.equal("apiKey" in request, false);
});

test("the proposal request is compact: only the anchored blocks and their fingerprints travel", () => {
  const settings = getDefaultEditorSettings("uk");
  const request = buildProposalRequest({ document, item: item("item-1"), settings, locale: "uk", editorialInstruction: "  коротше  " });

  assert.deepEqual(request.document.blocks.map((block) => block.id), ["p-1"]);
  assert.deepEqual(request.currentRevision.blockOrder, ["p-1"]);
  assert.equal(request.currentRevision.documentRevisionId, revision.documentRevisionId);
  assert.equal(request.currentRevision.blockFingerprints["p-1"], revision.blockFingerprints["p-1"]);
  assert.equal(request.editorialInstruction, "коротше");
  assert.equal(request.basePrompt, settings.basePrompt);
  assert.equal(request.item.id, "item-1");
  assert.equal("stepId" in request.item, false);
  assert.equal(buildProposalRequest({ document, item: item("item-1"), settings, locale: "uk" }).editorialInstruction, undefined);
});

test("a stale item is refreshed against the current text, or refused when its block is gone", () => {
  const edited: EditorDocument = {
    version: 2,
    blocks: document.blocks.map((block) => (block.id === "p-1" ? { ...block, content: [{ text: "Новий текст абзацу." }] } : block))
  } as EditorDocument;
  const refreshed = refreshItemAnchor({ ...item("item-1"), status: "stale", activeProposalId: "old" }, edited);

  assert.equal(refreshed?.status, "pending");
  assert.equal(refreshed?.activeProposalId, undefined);
  assert.equal(refreshed?.anchor.fingerprint, computeAnchorFingerprint(edited, ["p-1"]));
  assert.equal(refreshItemAnchor(item("item-1", ["p-gone"]), edited), null);
});

test("settings are read without writing anything back", () => {
  const writes: string[] = [];
  const storage = {
    getItem: (key: string) =>
      key === getEditorSettingsStorageKey("uk") ? JSON.stringify({ provider: "anthropic", modelId: "claude-test", basePrompt: "Мій промпт" }) : null,
    setItem: (key: string) => {
      writes.push(key);
    }
  };
  const settings = readEditorSettingsReadOnly(storage, "uk");

  assert.equal(settings.provider, "anthropic");
  assert.equal(settings.modelId, "claude-test");
  assert.equal(settings.basePrompt, "Мій промпт");
  assert.deepEqual(writes, []);
  assert.equal(readEditorSettingsReadOnly({ getItem: () => "{broken" }, "uk").provider, getDefaultEditorSettings("uk").provider);
});

/* ---------- calls ---------- */

test("start, cancel and prepare call the endpoints the classic editor uses", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });

    if (init?.method === "DELETE") {
      return json({ kind: "error", error: { code: "run_cancelled", message: "Запуск перевірки скасовано.", retryable: false } });
    }

    if (url.endsWith("/proposal")) {
      return json({ proposal: textDiffProposal });
    }

    return json({ kind: "run", run: run({ status: "pending" }), capability: "signed-cap" }, 202);
  };
  const deps = { messages, fetchImpl };
  const settings = getDefaultEditorSettings("uk");

  const started = await startReviewRun(buildReviewRunRequest({ document, settings, locale: "uk", stepId: "clarity", runMode: "replace", rejectedIdeas: [] }), deps);
  assert.equal(started.kind, "run");
  assert.equal(calls[0]!.url, "/api/edit/review");
  assert.equal(calls[0]!.init?.method, "POST");
  assert.equal(JSON.parse(String(calls[0]!.init?.body)).stepId, "clarity");

  assert.deepEqual(await cancelReviewRun({ runId: "run 1", capability: "signed-cap", locale: "uk" }, deps), { kind: "cancelled" });
  assert.equal(calls[1]!.url, "/api/edit/review?runId=run%201&locale=uk");
  assert.equal((calls[1]!.init?.headers as Record<string, string>)[REVIEW_RUN_CAPABILITY_HEADER], "signed-cap");

  const proposal = await prepareProposal(buildProposalRequest({ document, item: item("item-1"), settings, locale: "uk" }), deps);
  assert.equal(proposal.kind, "text_diff");
  assert.equal(calls[2]!.url, "/api/edit/review/proposal");
});

test("a request that never reaches the server is a network error with the cause", async () => {
  const fetchImpl = async () => {
    throw new TypeError("Failed to fetch");
  };
  const settings = getDefaultEditorSettings("uk");
  const started = await startReviewRun(
    buildReviewRunRequest({ document, settings, locale: "uk", stepId: "clarity", runMode: "replace", rejectedIdeas: [] }),
    { messages, fetchImpl }
  );
  assert.equal(started.kind === "error" && started.code, "network_error");
  assert.equal(started.kind === "error" && started.message, "NETWORK Failed to fetch");

  const proposal = await prepareProposal(buildProposalRequest({ document, item: item("item-1"), settings, locale: "uk" }), { messages, fetchImpl });
  assert.deepEqual(proposal, { kind: "error", message: "NETWORK Failed to fetch" });
});

/* ---------- polling ---------- */

function poller(replies: Array<() => Response | Promise<Response>>, overrides: Partial<Parameters<typeof pollReviewRun>[0]> = {}) {
  const urls: string[] = [];
  const capabilities: string[] = [];
  const snapshots: Array<{ ids: string[]; cursor: number; capability: string }> = [];
  let call = 0;

  const promise = pollReviewRun({
    messages,
    run: run({ status: "pending" }),
    capability: "cap-0",
    locale: "uk",
    getSourceChars: () => 100,
    isCurrent: () => true,
    acquireLease: () => true,
    wait: async () => undefined,
    onSnapshot: (update) => snapshots.push({ ids: update.items.map((entry) => entry.id), cursor: update.itemCursor, capability: update.capability }),
    fetchImpl: async (url, init) => {
      urls.push(url);
      capabilities.push((init?.headers as Record<string, string>)[REVIEW_RUN_CAPABILITY_HEADER]!);
      const next = replies[call];
      call += 1;

      if (!next) {
        throw new Error("unexpected extra poll");
      }

      return next();
    },
    ...overrides
  });

  return { promise, urls, capabilities, snapshots };
}

test("polling streams items with an advancing afterItem cursor and ends with the result", async () => {
  const { promise, urls, capabilities, snapshots } = poller([
    () => json({ kind: "run", run: run(), capability: "cap-1", items: [item("a")], itemCursor: 1, itemCount: 1 }),
    () => json({ kind: "run", run: run(), capability: "cap-2", items: [item("b"), item("c")], itemCursor: 3, itemCount: 3 }),
    () => json({ kind: "result", run: run({ status: "completed" }), result: result() })
  ]);
  const outcome = await promise;

  assert.equal(outcome.kind, "completed");
  assert.deepEqual(urls.map((url) => new URL(url, "http://x").searchParams.get("afterItem")), ["0", "1", "3"]);
  assert.equal(new URL(urls[0]!, "http://x").searchParams.get("runId"), "run-1");
  assert.equal(new URL(urls[0]!, "http://x").searchParams.get("locale"), "uk");
  assert.deepEqual(capabilities, ["cap-0", "cap-1", "cap-2"]);
  assert.deepEqual(snapshots, [
    { ids: ["a"], cursor: 1, capability: "cap-1" },
    { ids: ["b", "c"], cursor: 3, capability: "cap-2" }
  ]);
});

test("a recovered run resumes from the persisted cursor", async () => {
  const { promise, urls } = poller([() => json({ kind: "result", run: run({ status: "completed" }), result: result() })], { itemCursor: 7 });
  await promise;
  assert.equal(new URL(urls[0]!, "http://x").searchParams.get("afterItem"), "7");
});

test("a failed run reports the server's message and hands over the items that arrived with it", async () => {
  const { promise, snapshots } = poller([
    () =>
      json(
        {
          kind: "error",
          run: run({ status: "failed" }),
          error: { code: "provider_failed", message: "Модель недоступна.", retryable: false },
          items: [item("a")],
          itemCursor: 1,
          itemCount: 1
        },
        500
      )
  ]);
  const outcome = await promise;

  assert.equal(outcome.kind, "failed");
  assert.equal(outcome.kind === "failed" && outcome.message, "Модель недоступна.");
  assert.equal(outcome.kind === "failed" && outcome.code, "provider_failed");
  assert.deepEqual(snapshots.map((snapshot) => snapshot.ids), [["a"]]);
});

test("transient network failures are retried; a persistent one fails loud", async () => {
  const flaky = poller([
    () => {
      throw new TypeError("Failed to fetch");
    },
    () => json({ kind: "result", run: run({ status: "completed" }), result: result() })
  ]);
  assert.equal((await flaky.promise).kind, "completed");

  const down = poller(
    Array.from({ length: 4 }, () => () => {
      throw new TypeError("Failed to fetch");
    })
  );
  const outcome = await down.promise;
  assert.equal(outcome.kind === "failed" && outcome.code, "network_error");
  assert.equal(outcome.kind === "failed" && outcome.message, "NETWORK Failed to fetch");
});

test("a non-JSON platform page during polling fails the run with the platform message", async () => {
  const { promise } = poller([() => new Response("An error occurred with your deployment\nFUNCTION_INVOCATION_TIMEOUT", { status: 504 })]);
  const outcome = await promise;
  assert.equal(outcome.kind === "failed" && outcome.code, "platform_failure");
  assert.equal(outcome.kind === "failed" && outcome.message, "PLATFORM (HTTP 504)");
});

test("a stopped or replaced poller is superseded and reports nothing", async () => {
  let current = true;
  const stopped = poller(
    [
      () => {
        current = false;
        return json({ kind: "run", run: run(), capability: "cap-1", items: [item("a")], itemCursor: 1 });
      }
    ],
    { isCurrent: () => current }
  );
  assert.deepEqual(await stopped.promise, { kind: "superseded" });
  assert.deepEqual(stopped.snapshots, []);

  const leased = poller([], { acquireLease: () => false });
  assert.deepEqual(await leased.promise, { kind: "superseded" });
});

test("a run made for another interface language is refused", async () => {
  const { promise } = poller([], { run: run({ locale: "en" }) });
  const outcome = await promise;
  assert.equal(outcome.kind === "failed" && outcome.code, "wrong_locale");
});
