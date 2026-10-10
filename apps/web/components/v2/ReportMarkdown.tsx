"use client";

import { createElement, Fragment, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { isSafeSourceUrl } from "../../lib/v2/overview";

/**
 * The model's markdown, shown as written, and never trusted. The text comes from a model that read the
 * manuscript, and the manuscript may come from anywhere, so:
 *
 * - images are never rendered: an `<img>` would make the browser call the address in the report on every
 *   render and every reload (the report is stored); only the alt text is kept;
 * - raw HTML stays text (no `rehype-raw`);
 * - a link is a link only for a plain http(s) address, and opens in a new tab without an opener.
 *
 * Written with `createElement` so the unit tests can render it without a JSX runtime.
 */
export function ReportMarkdown({ text, tableClassName }: { text: string; tableClassName?: string }) {
  return createElement(
    ReactMarkdown,
    {
      remarkPlugins: [remarkGfm],
      components: {
        img: ({ alt }: { alt?: string }) => (alt ? createElement(Fragment, null, alt) : null),
        table: ({ children }: { children?: ReactNode }) =>
          createElement("div", { className: tableClassName }, createElement("table", null, children)),
        a: ({ href, children }: { href?: string; children?: ReactNode }) =>
          href && isSafeSourceUrl(href)
            ? createElement("a", { href, target: "_blank", rel: "noopener noreferrer" }, children)
            : createElement(Fragment, null, children)
      }
    },
    text
  );
}
