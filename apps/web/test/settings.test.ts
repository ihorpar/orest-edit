import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_CALLOUT_PROMPT_TEMPLATE } from "../lib/editor/settings.ts";

test("DEFAULT_CALLOUT_PROMPT_TEMPLATE documents every supported callout kind explicitly", () => {
  assert.match(DEFAULT_CALLOUT_PROMPT_TEMPLATE, /mechanism:/i);
  assert.match(DEFAULT_CALLOUT_PROMPT_TEMPLATE, /analogy:/i);
  assert.match(DEFAULT_CALLOUT_PROMPT_TEMPLATE, /everyday_application:/i);
  assert.match(DEFAULT_CALLOUT_PROMPT_TEMPLATE, /myths_vs_truth:/i);
  assert.match(DEFAULT_CALLOUT_PROMPT_TEMPLATE, /top_list:/i);
});
