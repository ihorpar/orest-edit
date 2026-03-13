# UI Concepts for Multi-Step Editorial Review Workflow

Based on the [EXECPLAN_MULTI_STEP_EDITORIAL_REVIEW_WORKFLOW.md](file:///c:/Projects/oboz-ai/orest-edit/docs/plans/EXECPLAN_MULTI_STEP_EDITORIAL_REVIEW_WORKFLOW.md), here are 5 UI/UX concepts for managing the 8-step Ukrainian editorial review process.

---

## 1. The Vertical Wizard (Timeline Sidebar)
Traditional vertical stepper placed at the top of the `EditorialReviewDrawer`.

- **How it works:** A vertical trace of 8 steps on the left side of the sidebar (or top). The active step expands to show its specific interactive content (e.g., Fact-check table or Clarity text). Completed steps show a checkmark 🟢.
- **Pros:**
    - **Clear Hierarchy:** Excellent for showing the "recommended order" mentioned in the plan.
    - **Context Retention:** You can see where you are in the 8-step journey at all times.
    - **Familiarity:** Users understand wizards; it reduces cognitive load for complex tasks.

## 2. The Task Dashboard (Status Overview)
The drawer starts with a high-level "Review Health" dashboard.

- **How it works:** Instead of jumping straight to step 1, the user sees 8 "cards" or "tiles" representing the steps. Each card shows a status (Not started, In progress, Done) and a mini-summary. Clicking a card enters that step.
- **Pros:**
    - **Non-Linear Flexibility:** Highlighting the "jump back to any prior step" requirement.
    - **Sense of Achievement:** Clear visual progress (e.g., 3/8 steps done).
    - **Summary-First:** Great for editors who want to see the Fact-check results without leaving the Diagnostics summary.

## 3. The Horizontal Tabbed Rail
Uses the top space of the sidebar for 8 compact, icon-based tabs.

- **How it works:** 8 small tabs (e.g., 🩺, 🔍, 🏗️, ✨...) at the top. Switching tabs changes the entire body of the sidebar.
- **Pros:**
    - **Space Efficiency:** Leaves maximum vertical space for the scrollable content (Fact-check tables, long Markdown analysis).
    - **Instant Access:** One-click jumping between "Clarity" and "Visuals" without scrolling a stepper.
    - **Modern Look:** Feels like a "Pro Tool" (similar to IDEs or professional editors).

## 4. The Contextual Mini-Hub (Mini-Sidebar)
A very narrow secondary rail (32px-40px) pinned to the right edge.

- **How it works:** Always visible. Steps are represented by vertical text or icons. Hovering shows the step name; clicking opens the main drawer to that step.
- **Pros:**
    - **Ubiquity:** The workflow switcher is always there, even when the main drawer is closed or showing a specific card.
    - **Zero Distraction:** Doesn't "eat" space inside the review drawer's body.
    - **Fast Switching:** Allows the editor to keep the drawer open and flick through steps while reading the manuscript.

## 5. The Split-Screen "Edit Room" (Full Focus)
A toggle that slides the central text to the left and opens a wide review workspace (60% of the screen).

- **How it works:** For steps like `Факт-чек` where a table is needed, the UI expands beyond a narrow sidebar. It provides a rich editor-side-by-side view.
- **Pros:**
    - **Table-Friendly:** Only way to comfortably fit 3 columns (`Твердження`, `Статус`, `Джерела`) without cramming.
    - **Deep Review:** Best for the "Diagnostics" phase where narrative text is long.
    - **Professional Feel:** Changes the environment to signify "I am now in Deep Review mode".

---

### Comparison Matrix

| Option | Best For | Implementation Effort | Scaling |
| :--- | :--- | :--- | :--- |
| **1. Vertical Wizard** | Guided experience | Low | High (very stable) |
| **2. Dashboard** | Overview & Status | Medium | High |
| **3. Tabs** | Power users | Low | Medium (8 tabs is a lot) |
| **4. Mini-Hub** | Fast multitasking | Medium | High |
| **5. Edit Room** | Fact-checking & Density | High | Very High |

### Recommendation
For the initial implementation of the **Multi-Step Workflow**, a **Hybrid Vertical Wizard** is recommended:
- Use a **Vertical Stepper** that is collapsible.
- Use the **Edit Room** expansion *only* for the `Факт-чек` step to allow for the table width.
