# Prompt Quality Eval
Generated at: 2026-04-16T14:38:06.041Z
Overall: **PASS** (16/18, 88.9%)

| Dimension | Status | Score |
| --- | --- | --- |
| Deep callout guidance is specific enough | PASS | 3/3 |
| Prompt prevents generic medical disclaimers | PASS | 3/3 |
| Bold usage is guided and constrained | PASS | 3/3 |
| Diagnostics rubric is concrete and actionable | PASS | 3/3 |
| Visual generation style guidance is well-specified | FAIL | 1/3 |
| Markdown ban is strict enough | PASS | 3/3 |

## Visual generation style guidance is well-specified
Missing signals:
- composition-sequence: Prompt gives composition order (scene -> composition -> elements -> style).
- anti-cliche-visual-guardrails: Prompt avoids stock visual clichés and photoreal noise.
