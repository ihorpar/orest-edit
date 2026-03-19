# Spellcheck API Contract

Status: backend contract implemented, editor UI not yet wired
Date: 2026-03-19

## Goal

Add a manual Ukrainian spellcheck flow for a selected fragment without introducing whole-document character-offset editing.

The request is intentionally local:
- one manual button
- one selected fragment
- one text block at a time
- diff-first manuscript editing stays unchanged

## Endpoint

`POST /api/edit/spellcheck`

The route should require the same authenticated session as other editor API routes.

## Request

```json
{
  "documentRevisionId": "rev_2026_03_19_001",
  "language": "uk-UA",
  "provider": "languagetool_public",
  "trigger": "manual",
  "selection": {
    "blockId": "p-7g9asd2k",
    "text": "У паціента можуть виникати супутні симптоми.",
    "range": {
      "start": 0,
      "end": 47
    }
  }
}
```

## Response

```json
{
  "documentRevisionId": "rev_2026_03_19_001",
  "providerUsed": "languagetool_public",
  "language": "uk-UA",
  "selection": {
    "blockId": "p-7g9asd2k",
    "text": "У паціента можуть виникати супутні симптоми.",
    "range": {
      "start": 0,
      "end": 47
    }
  },
  "issues": [
    {
      "id": "spell-a1b2c3d4",
      "ruleId": "UK_SPELLING",
      "category": "misspelling",
      "severity": "error",
      "message": "Можлива орфографічна помилка.",
      "shortMessage": "Орфографія",
      "range": {
        "start": 2,
        "end": 10
      },
      "badText": "паціента",
      "suggestions": [
        { "value": "пацієнта" }
      ]
    }
  ],
  "diagnostics": {
    "requestId": "spellcheck-m4n3q2p1",
    "requestedProvider": "languagetool_public",
    "providerUsed": "languagetool_public",
    "language": "uk-UA",
    "trigger": "manual",
    "selectionBlockId": "p-7g9asd2k",
    "selectedTextLength": 47,
    "issueCount": 1,
    "truncated": false,
    "generatedAt": "2026-03-19T14:22:00.000Z",
    "upstreamLatencyMs": 412
  }
}
```

## Field semantics

- `selection.text` is the full plain text of the source block at request time.
- `selection.range` is the selected fragment inside that block, using zero-based offsets and exclusive `end`.
- `issues[].range` is relative to `selection.text`, not relative to the whole document.
- `issues[]` must be clipped to the selected fragment. Matches outside the selected fragment are dropped.
- `badText` must equal `selection.text.slice(range.start, range.end)` after normalization.
- `suggestions` are ordered best-first and can be empty.

## Why block-local range offsets are acceptable here

The product remains block-first for editing and patch application.

Spellcheck is different from patch application:
- it does not replace blocks automatically
- it only annotates a currently selected text fragment
- accepted fixes can later be applied as a local inline replacement inside the same block

That keeps the patch-first model intact while still allowing precise underline rendering.

## Provider mapping

The client should only know the local contract above.

The server maps it to LanguageTool:
- `selection.text.slice(range.start, range.end)` is sent upstream
- upstream offsets are re-based back into block-local offsets before returning
- the route can later switch from `languagetool_public` to `languagetool_self_hosted` without changing client code

## Constraints

- `language` is fixed to `uk-UA` in v1
- `trigger` is fixed to `manual` in v1
- one request checks one block-local fragment only
- no background checking on each keystroke
- no whole-chapter spellcheck in v1
- no grammar/style auto-apply in v1

## Error handling

Validation failures should return `400` with localized Ukrainian `error`.

Recommended non-success cases:
- invalid JSON
- missing `documentRevisionId`
- empty `selection.text`
- invalid `selection.range`
- empty selected fragment after slicing
- unsupported `provider`

Upstream LanguageTool failures should return a successful shape with:
- `issues: []`
- localized `error`
- `diagnostics.rawError`

This matches the app’s current API pattern and keeps the UI predictable.
