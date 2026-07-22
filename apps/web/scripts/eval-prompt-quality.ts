import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { computeAnchorFingerprint, deriveManuscriptRevisionState } from "../lib/editor/manuscript-structure.ts";
import type { EditorDocument } from "../lib/editor/document-model.ts";
import type { EditorialReviewRequest, ReviewActionRequest } from "../lib/editor/review-contract.ts";
import { generateEditorialReview } from "../lib/server/review-service.ts";
import { generateReviewAction } from "../lib/server/review-action-service.ts";

type CapturedPrompts = {
  deepCalloutPrompt: string;
  rewritePrompt: string;
  diagnosticsPrompt: string;
  clarityPrompt: string;
  visualPrompt: string;
};

type EvalCheck = {
  id: string;
  description: string;
  patterns: RegExp[];
};

type EvalDimension = {
  key: string;
  title: string;
  source: string;
  checks: EvalCheck[];
};

type DimensionResult = {
  key: string;
  title: string;
  source: string;
  passed: number;
  total: number;
  score: number;
  status: "pass" | "warn" | "fail";
  failedChecks: Array<{ id: string; description: string }>;
};

const PASS_THRESHOLD = 0.8;
const WARN_THRESHOLD = 0.5;

function createDocument(): EditorDocument {
  return {
    version: 2,
    blocks: [
      { id: "h1", type: "heading", level: 2, content: [{ text: "Розділ про інтерпретацію симптомів" }] },
      {
        id: "p1",
        type: "paragraph",
        content: [
          {
            text:
              "Зміни шкіри можуть з'являтися з різних причин. Один симптом не дає остаточного висновку, а контекст і поєднання ознак визначають, наскільки фрагмент потребує обережної інтерпретації."
          }
        ]
      },
      {
        id: "p2",
        type: "paragraph",
        content: [
          {
            text:
              "Щоб читач не загубився, матеріал потрібно структурувати: виділити ключову думку, прибрати надмірну категоричність і показати причинно-наслідкові зв'язки простими словами."
          }
        ]
      }
    ]
  };
}

function collectStrings(value: unknown, output: string[]): void {
  if (typeof value === "string") {
    output.push(value);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectStrings(item, output);
    }
    return;
  }

  if (value && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) {
      collectStrings(item, output);
    }
  }
}

async function captureReviewActionPrompt(
  request: ReviewActionRequest,
  outputText: string
): Promise<string> {
  let promptText = "";

  await generateReviewAction(request, {
    fetchImpl: async (_input, init) => {
      const payload = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      const strings: string[] = [];
      collectStrings(payload, strings);
      promptText = strings.join("\n");

      return new Response(
        JSON.stringify({
          output_text: outputText
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
  });

  return promptText;
}

async function captureEditorialPrompt(
  request: EditorialReviewRequest,
  outputText: string
): Promise<string> {
  let promptText = "";

  await generateEditorialReview(request, {
    fetchImpl: async (_input, init) => {
      const payload = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      const strings: string[] = [];
      collectStrings(payload, strings);
      promptText = strings.join("\n");

      return new Response(
        JSON.stringify({
          output_text: outputText
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
  });

  return promptText;
}

async function capturePrompts(): Promise<CapturedPrompts> {
  const document = createDocument();
  const revision = deriveManuscriptRevisionState(document);

  const deepCalloutRequest: ReviewActionRequest = {
    document,
    currentRevision: revision,
    provider: "openai",
    modelId: "gpt-5.6-luna",
    apiKey: "test-key",
    item: {
      id: "eval-callout-deep",
      reviewSessionId: "eval-session",
      documentRevisionId: revision.documentRevisionId,
      changeLevel: 3,
      title: "Додати deep callout",
      reason: "Потрібен глибший контекст для читача.",
      recommendation: "Створити врізку з міфами й фактами, щоб пояснити обмеження симптомів.",
      recommendationType: "callout",
      suggestedAction: "prepare_callout",
      priority: "medium",
      anchor: {
        blockIds: ["p1"],
        generationBlockRange: { start: 1, end: 1 },
        excerpt: "Зміни шкіри можуть з'являтися з різних причин.",
        fingerprint: computeAnchorFingerprint(document, ["p1"])
      },
      insertionPoint: { mode: "after", anchorBlockId: "p1" },
      calloutKind: "myths_vs_truth",
      calloutDepth: "deep",
      status: "pending"
    }
  };

  const rewriteRequest: ReviewActionRequest = {
    document,
    currentRevision: revision,
    provider: "openai",
    modelId: "gpt-5.6-luna",
    apiKey: "test-key",
    item: {
      id: "eval-rewrite",
      reviewSessionId: "eval-session",
      documentRevisionId: revision.documentRevisionId,
      changeLevel: 3,
      title: "Знизити категоричність",
      reason: "Потрібне локальне пом'якшення формулювання.",
      recommendation: "Переформулювати обережніше і читабельніше.",
      recommendationType: "rewrite",
      suggestedAction: "rewrite_text",
      priority: "medium",
      anchor: {
        blockIds: ["p1"],
        generationBlockRange: { start: 1, end: 1 },
        excerpt: "Один симптом не дає остаточного висновку.",
        fingerprint: computeAnchorFingerprint(document, ["p1"])
      },
      insertionPoint: { mode: "replace", anchorBlockId: "p1" },
      status: "pending"
    }
  };

  const visualRequest: ReviewActionRequest = {
    document,
    currentRevision: revision,
    provider: "openai",
    modelId: "gpt-5.6-luna",
    apiKey: "test-key",
    item: {
      id: "eval-visual",
      reviewSessionId: "eval-session",
      documentRevisionId: revision.documentRevisionId,
      changeLevel: 3,
      title: "Підготувати візуал",
      reason: "Потрібно пояснити причинно-наслідковий ланцюг.",
      recommendation: "Показати інфографіку з порівнянням факторів.",
      recommendationType: "visual",
      suggestedAction: "prepare_visual",
      priority: "medium",
      anchor: {
        blockIds: ["p2"],
        generationBlockRange: { start: 2, end: 2 },
        excerpt: "Потрібно структурувати причинно-наслідкові зв'язки.",
        fingerprint: computeAnchorFingerprint(document, ["p2"])
      },
      insertionPoint: { mode: "after", anchorBlockId: "p2" },
      visualIntent: "infographic",
      status: "pending"
    }
  };

  const baseReviewRequest: Omit<EditorialReviewRequest, "stepId"> = {
    document,
    revision,
    provider: "openai",
    modelId: "gpt-5.6-luna",
    apiKey: "test-key",
    changeLevel: 3
  };

  const deepCalloutPrompt = await captureReviewActionPrompt(
    deepCalloutRequest,
    JSON.stringify({ title: "Міфи і правда", body: "Міф: ...\nПравда: ..." })
  );
  const rewritePrompt = await captureReviewActionPrompt(
    rewriteRequest,
    JSON.stringify({ replacements: ["Один симптом може мати різні причини."] })
  );
  const visualPrompt = await captureReviewActionPrompt(
    visualRequest,
    "Побудуй інфографіку з чітким порівнянням факторів і мінімалістичною композицією."
  );
  const diagnosticsPrompt = await captureEditorialPrompt(
    { ...baseReviewRequest, stepId: "diagnostics" },
    "## Головний діагноз розділу\nТест."
  );
  const clarityPrompt = await captureEditorialPrompt(
    { ...baseReviewRequest, stepId: "clarity" },
    JSON.stringify({ items: [] })
  );

  return {
    deepCalloutPrompt,
    rewritePrompt,
    diagnosticsPrompt,
    clarityPrompt,
    visualPrompt
  };
}

function evaluateDimension(dimension: EvalDimension): DimensionResult {
  let passed = 0;
  const failedChecks: Array<{ id: string; description: string }> = [];

  for (const check of dimension.checks) {
    const ok = check.patterns.some((pattern) => pattern.test(dimension.source));
    if (ok) {
      passed += 1;
    } else {
      failedChecks.push({ id: check.id, description: check.description });
    }
  }

  const total = dimension.checks.length;
  const score = total === 0 ? 0 : passed / total;
  const status: DimensionResult["status"] =
    score >= PASS_THRESHOLD ? "pass" : score >= WARN_THRESHOLD ? "warn" : "fail";

  return {
    key: dimension.key,
    title: dimension.title,
    source: dimension.source,
    passed,
    total,
    score,
    status,
    failedChecks
  };
}

function createDimensions(prompts: CapturedPrompts): EvalDimension[] {
  const deepAndRewrite = `${prompts.deepCalloutPrompt}\n${prompts.rewritePrompt}`;
  const allPrompts = [
    prompts.deepCalloutPrompt,
    prompts.rewritePrompt,
    prompts.diagnosticsPrompt,
    prompts.clarityPrompt,
    prompts.visualPrompt
  ].join("\n");

  return [
    {
      key: "deep_callout",
      title: "Deep callout guidance is specific enough",
      source: prompts.deepCalloutPrompt,
      checks: [
        {
          id: "deep-mode-explicit",
          description: "Prompt clearly distinguishes deep mode from brief mode.",
          patterns: [/\bdeep\b/i, /докладн/i, /глибин/i]
        },
        {
          id: "deep-structure-length",
          description: "Prompt asks for meaningful depth (paragraph count or equivalent structure).",
          patterns: [/(3-6|3–6).*(абзац|paragraph)/i, /(декільк|кільк).*(абзац|параграф)/i]
        },
        {
          id: "avoid-wall-of-text",
          description: "Prompt discourages one dense block and asks for structure.",
          patterns: [/суцільн.*полотн/i, /(якір|підзаголов|anchor)/i, /коротк.*список/i]
        }
      ]
    },
    {
      key: "no_medical_disclaimer",
      title: "Prompt prevents generic medical disclaimers",
      source: `${prompts.clarityPrompt}\n${prompts.rewritePrompt}`,
      checks: [
        {
          id: "ban-disclaimer-boilerplate",
          description: "Prompt forbids generic safety/disclaimer boilerplate.",
          patterns: [/дисклеймер/i, /застереж/i, /boilerplate/i]
        },
        {
          id: "ban-see-doctor-default",
          description: "Prompt forbids default 'consult a doctor' language.",
          patterns: [/(не|без).*(лікар|консультац)/i, /consult.*doctor/i]
        },
        {
          id: "ban-self-diagnosis-phrases",
          description: "Prompt mentions avoiding self-diagnosis clichés.",
          patterns: [/самодіагност/i, /self-diagnosis/i]
        }
      ]
    },
    {
      key: "bold_usage",
      title: "Bold usage is guided and constrained",
      source: deepAndRewrite,
      checks: [
        {
          id: "allow-purposeful-bold",
          description: "Prompt allows bold for key anchors and core ideas.",
          patterns: [/жирн/i, /\*\*[^*]+\*\*/i, /ключов/i]
        },
        {
          id: "limit-overuse",
          description: "Prompt explicitly limits overuse of bold.",
          patterns: [/(не|без).*(весь|цілий).*(жирн|bold)/i, /контрольован/i, /sparse/i]
        },
        {
          id: "structure-over-decoration",
          description: "Prompt ties bold to scanability/structure, not decoration.",
          patterns: [/скан|scan/i, /підзаголов/i, /anchor/i]
        }
      ]
    },
    {
      key: "diagnostics_rubric",
      title: "Diagnostics rubric is concrete and actionable",
      source: prompts.diagnosticsPrompt,
      checks: [
        {
          id: "sectioned-rubric",
          description: "Prompt enforces clear diagnostics sections.",
          patterns: [/головн.*діагноз/i, /карта розділу/i, /пріоритетн.*план/i]
        },
        {
          id: "evidence-by-paragraph",
          description: "Prompt asks for evidence tied to paragraph anchors.",
          patterns: [/абз\./i, /paragraph/i, /NNN/i]
        },
        {
          id: "critical-not-flattering",
          description: "Prompt requests critical analysis instead of praise.",
          patterns: [/не.*похвал/i, /сувор/i, /критич/i]
        }
      ]
    },
    {
      key: "visual_style",
      title: "Visual generation style guidance is well-specified",
      source: prompts.visualPrompt,
      checks: [
        {
          id: "visual-intent-mapping",
          description: "Prompt maps intent to infographic/illustration behavior.",
          patterns: [/visualIntent/i, /infographic/i, /illustration/i, /інфограф/i]
        },
        {
          id: "composition-sequence",
          description: "Prompt gives composition order (scene -> composition -> elements -> style).",
          patterns: [/сцена.*композиц/i, /composition/i, /ключов.*елемент/i]
        },
        {
          id: "anti-cliche-visual-guardrails",
          description: "Prompt avoids stock visual clichés and photoreal noise.",
          patterns: [/фотореал/i, /стоков/i, /mockup/i, /декоративн.*шум/i]
        }
      ]
    },
    {
      key: "markdown_ban",
      title: "Markdown ban is strict enough",
      source: allPrompts,
      checks: [
        {
          id: "single-plain-output",
          description: "Prompt asks for single plain-text output block.",
          patterns: [/plain text/i, /(один|рівно один).*(блок|prompt)/i]
        },
        {
          id: "forbid-headings-sections",
          description: "Prompt forbids headings/sections/structured markdown wrappers.",
          patterns: [/(не|без).*(markdown|заголовк|нумерац|section)/i, /не.*#.*##/i]
        },
        {
          id: "json-or-plain-only",
          description: "Prompt constrains output format to JSON or plain text only.",
          patterns: [/лише JSON/i, /без іншого markdown/i, /single prompt/i]
        }
      ]
    }
  ];
}

function statusLabel(status: DimensionResult["status"]): string {
  if (status === "pass") {
    return "PASS";
  }
  if (status === "warn") {
    return "WARN";
  }
  return "FAIL";
}

function buildMarkdownReport(
  generatedAt: string,
  results: DimensionResult[],
  overall: { passed: number; total: number; score: number; status: "pass" | "warn" | "fail" }
): string {
  const lines: string[] = [];
  lines.push(`# Prompt Quality Eval`);
  lines.push(`Generated at: ${generatedAt}`);
  lines.push(`Overall: **${statusLabel(overall.status)}** (${overall.passed}/${overall.total}, ${(overall.score * 100).toFixed(1)}%)`);
  lines.push("");
  lines.push("| Dimension | Status | Score |");
  lines.push("| --- | --- | --- |");

  for (const result of results) {
    lines.push(`| ${result.title} | ${statusLabel(result.status)} | ${result.passed}/${result.total} |`);
  }

  for (const result of results) {
    if (result.failedChecks.length === 0) {
      continue;
    }

    lines.push("");
    lines.push(`## ${result.title}`);
    lines.push(`Missing signals:`);
    for (const check of result.failedChecks) {
      lines.push(`- ${check.id}: ${check.description}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  const failOnWarn = process.argv.includes("--strict");
  const generatedAt = new Date().toISOString();
  const prompts = await capturePrompts();
  const dimensions = createDimensions(prompts);
  const results = dimensions.map(evaluateDimension);
  const passed = results.reduce((sum, item) => sum + item.passed, 0);
  const total = results.reduce((sum, item) => sum + item.total, 0);
  const score = total === 0 ? 0 : passed / total;
  const overallStatus: "pass" | "warn" | "fail" =
    score >= PASS_THRESHOLD ? "pass" : score >= WARN_THRESHOLD ? "warn" : "fail";
  const overall = { passed, total, score, status: overallStatus };

  const webRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
  const reportsDir = path.join(webRoot, "evals", "reports");
  fs.mkdirSync(reportsDir, { recursive: true });

  const stamp = generatedAt.replace(/[:.]/g, "-");
  const baseName = `prompt-quality-${stamp}`;
  const jsonPath = path.join(reportsDir, `${baseName}.json`);
  const mdPath = path.join(reportsDir, `${baseName}.md`);
  const latestJsonPath = path.join(reportsDir, "prompt-quality-latest.json");
  const latestMdPath = path.join(reportsDir, "prompt-quality-latest.md");

  const reportJson = {
    generatedAt,
    thresholds: {
      pass: PASS_THRESHOLD,
      warn: WARN_THRESHOLD
    },
    overall,
    dimensions: results.map((result) => ({
      key: result.key,
      title: result.title,
      status: result.status,
      score: result.score,
      passed: result.passed,
      total: result.total,
      failedChecks: result.failedChecks
    })),
    promptSamples: {
      deepCalloutPrompt: prompts.deepCalloutPrompt.slice(0, 4000),
      rewritePrompt: prompts.rewritePrompt.slice(0, 4000),
      diagnosticsPrompt: prompts.diagnosticsPrompt.slice(0, 4000),
      clarityPrompt: prompts.clarityPrompt.slice(0, 4000),
      visualPrompt: prompts.visualPrompt.slice(0, 4000)
    }
  };

  fs.writeFileSync(jsonPath, JSON.stringify(reportJson, null, 2), "utf8");
  fs.writeFileSync(latestJsonPath, JSON.stringify(reportJson, null, 2), "utf8");

  const markdown = buildMarkdownReport(generatedAt, results, overall);
  fs.writeFileSync(mdPath, markdown, "utf8");
  fs.writeFileSync(latestMdPath, markdown, "utf8");

  console.log(`Prompt quality eval: ${statusLabel(overall.status)} (${passed}/${total}, ${(score * 100).toFixed(1)}%)`);
  for (const result of results) {
    console.log(`- ${statusLabel(result.status)} ${result.title}: ${result.passed}/${result.total}`);
    for (const check of result.failedChecks) {
      console.log(`  * missing ${check.id}: ${check.description}`);
    }
  }
  console.log(`Report (latest JSON): ${latestJsonPath}`);
  console.log(`Report (latest MD): ${latestMdPath}`);

  const hasFail = results.some((result) => result.status === "fail");
  const hasWarn = results.some((result) => result.status === "warn");
  if (failOnWarn && (hasFail || hasWarn)) {
    process.exitCode = 1;
  }
}

await main();
