# Requirements Document

## Introduction

The **Theory Library** is a standalone, browsable reference surface for every grammar topic the app teaches, decoupled from the drill flow. Today, theory content (`theory_topics.content_json`, rendered via the `TheoryPanel` slide-over) is only reachable as an in-drill aside — a pill on a drill card opens the panel scrolled to the topic for the current exercise. There is no way to deliberately browse, search, or read a topic without first entering a drill.

This feature adds a first-class `/theory` destination: an **index** page that lists all approved topics for the learner's active language — grouped (by category, by CEFR level, or flat), sortable (curriculum order or A→Z), and searchable — and a **dedicated, deep-linkable detail route** (`/theory/[topicId]`) that renders the full topic (sections + table-of-contents) reusing the existing theory content renderers. It is read-only reference: the learner reviews grammar on its own terms and can step back into a drill when ready.

**v1 scope decisions (locked with the product owner):**

- **Detail view** is a dedicated route `/theory/[topicId]` (deep-linkable, back-button-friendly), not a slide-over overlay.
- **Mastery is deferred.** No per-topic mastery bars, no "weakest first" sort, no "weakest right now" column. v1 sorts are curriculum order and A→Z only.
- **Category grouping is included.** A new category taxonomy is introduced and each topic is mapped to a category via its curriculum grammar point (`grammarPointKey`). Grouping options are: category, CEFR level, flat list.
- **The "from your drill" personalization strip is deferred** (today's-topic + recently-viewed). The index opens directly to header → search → group/sort → topic list.

## Alignment with Product Vision

From `product.md` / `CLAUDE.md`, the product targets the **intermediate plateau** and positions itself as _"what you do between italki sessions."_ The Theory Library directly supports this:

- **Active production, supported by reference.** The app forces written/spoken production; a learner who stumbles on `por` vs `para` mid-session needs a fast, trustworthy place to read the rule. A standalone library makes that reference available _outside_ a forced drill, which is exactly the "between sessions" behavior the positioning describes.
- **Skill-based mastery, mapped to CEFR.** The library is organized along the same spine as the rest of the app — topics carry their CEFR level and are groupable by it — reinforcing CEFR as the single progress spine without introducing XP/streak mechanics.
- **Polyglot-first.** The library is scoped to the learner's active language (ES/DE/TR), consistent with the per-language curriculum and the existing active-language context.
- **Reuse over reinvention.** Content is the same generated `TheoryTopicJson` already produced by the theory-generation pipeline and rendered by the existing theory components — no new content model, no new authoring path.

Out of scope (consistent with product guardrails): gamification, social features, and — for v1 — mastery surfacing and drill personalization.

## Requirements

### Requirement 1 — Discoverable navigation entry

**User Story:** As a learner, I want a "theory" item in the primary navigation, so that I can reach grammar reference at any time without being inside a drill.

#### Acceptance Criteria

1. WHEN the dashboard shell renders THEN the system SHALL display a "theory" destination in both the desktop nav rail and the mobile tab bar, sourced from the single `NAV_DESTINATIONS` definition.
2. WHEN the learner activates the "theory" nav item THEN the system SHALL navigate to `/theory`.
3. WHEN the learner is on `/theory` or any `/theory/[topicId]` route THEN the system SHALL render the "theory" nav item in its active/selected state.
4. WHEN the nav item is rendered THEN it SHALL appear after "read" and before "progress" in the destination order.

### Requirement 2 — Browse all topics for the active language

**User Story:** As a learner, I want to see every grammar topic available for my active language in one place, so that I understand the full scope of what the app covers and can pick what to review.

#### Acceptance Criteria

1. WHEN the `/theory` page loads THEN the system SHALL fetch and display the list of approved topics for the learner's active language (ES/DE/TR), using the active-language context as the source of the language.
2. WHEN topics are displayed THEN each topic row SHALL show the topic title and its CEFR-level chip.
3. WHEN the active language changes via the existing active-language switcher THEN the system SHALL display the topic list for the newly active language.
4. WHEN the active language has no approved topics THEN the system SHALL display an explicit empty state (not a blank page or an error), explaining no topics are available yet for that language.
5. WHEN the topic list is loading THEN the system SHALL display a loading affordance, and WHEN the fetch fails THEN the system SHALL display an error state with a retry affordance.
6. WHEN the page header renders THEN it SHALL display the title "theory library." and the total count of approved topics for the active language (the header count reflects the full language total and does NOT change with the active search query; per-group and search-result counts are specified separately in Requirements 3.6 and 5.3).

### Requirement 3 — Group topics by category, CEFR level, or flat list

**User Story:** As a learner, I want to switch how topics are grouped, so that I can navigate either by grammar theme, by my level, or as a single list.

#### Acceptance Criteria

1. WHEN the index renders THEN the system SHALL provide a group-by control with exactly three options: "category", "CEFR level", and "flat list", defaulting to "category".
2. WHEN group-by is "category" THEN the system SHALL group topics into category sections, ordering categories by a stable, defined order, and SHALL place any topic with no resolvable category into a clearly labeled fallback group (e.g. "other") rendered last.
3. WHEN group-by is "CEFR level" THEN the system SHALL group topics under level headings in the order A1, A2, B1, B2, C1, C2, omitting any level with zero topics.
4. WHEN group-by is "flat list" THEN the system SHALL render all topics as a single ungrouped list.
5. WHEN a group contains zero topics after filtering THEN the system SHALL NOT render an empty group header.
6. WHEN each group header renders THEN it SHALL display the group label and the count of topics in that group.
7. WHEN a topic's category is resolved THEN it SHALL be derived from the topic's curriculum grammar point (`grammarPointKey`) via a defined category mapping, computed server-side so the client receives each topic's category directly.

### Requirement 4 — Sort topics within groups

**User Story:** As a learner, I want to choose the order topics appear in, so that I can follow the curriculum sequence or scan alphabetically.

#### Acceptance Criteria

1. WHEN the index renders THEN the system SHALL provide a sort control with exactly two options: "curriculum" (curriculum order) and "A → Z" (alphabetical), defaulting to "curriculum".
2. WHEN sort is "curriculum" THEN the system SHALL order topics by their position in the active language's curriculum sequence (derived from the grammar-point curriculum), with topics lacking a curriculum position sorted last by title.
3. WHEN sort is "A → Z" THEN the system SHALL order topics alphabetically by title using locale-aware comparison.
4. WHEN both grouping and sorting are active THEN the system SHALL apply the sort within each group independently.
5. The system SHALL NOT offer a mastery-based ("weakest first") sort in v1.

### Requirement 5 — Search topics

**User Story:** As a learner, I want to search topics by name or keyword, so that I can jump straight to the rule I need.

#### Acceptance Criteria

1. WHEN the index renders THEN the system SHALL display a search input with placeholder guidance (e.g. an example query) at the top of the topic browsing area.
2. WHEN the learner types a non-empty query THEN the system SHALL filter the topic list, matching case-insensitively against each topic's title and its CEFR-level label (the only searchable fields present on list items in v1; the stored topic model carries no tags/keywords).
3. WHEN a search query is active THEN the system SHALL collapse grouping into a single "results" list (with a result count shown), SHALL order results by the currently active sort, and SHALL highlight the matched substring within each result title.
4. WHEN a search query matches no topics THEN the system SHALL display a "no topics match" empty state with a one-tap action to clear the search.
5. WHEN a search query is present THEN the system SHALL provide a visible control to clear the query and return to the grouped view.
6. WHEN the page is viewed on desktop AND focus is not already in a text input THEN pressing ⌘K / Ctrl+K SHALL preventDefault and focus the search input.

### Requirement 6 — Open a topic to a dedicated detail page

**User Story:** As a learner, I want each topic to have its own page I can open, link to, and use the browser back button with, so that reviewing theory feels like reading a real reference, not a transient popup.

#### Acceptance Criteria

1. WHEN the learner activates a topic row in the index THEN the system SHALL navigate to `/theory/[topicId]` for that topic.
2. WHEN `/theory/[topicId]` loads THEN the system SHALL fetch the full topic content for the active language and render its title, CEFR chip, subtitle, all sections, and a table of contents, reusing the existing theory content/TOC renderers.
3. WHEN a section in the table of contents is activated THEN the system SHALL scroll the corresponding section into view, and the TOC SHALL reflect the currently in-view section.
4. WHEN `/theory/[topicId]` is loaded directly (deep link / refresh) for a valid topic THEN the system SHALL render that topic without requiring prior navigation through the index.
5. WHEN `[topicId]` does not resolve to an approved topic for the active language THEN the system SHALL render a not-found state offering a link back to the library (reusing the existing theory empty/fallback affordance), rather than crashing.
6. WHEN the detail page renders THEN it SHALL provide a clear way to return to the library index (`/theory`).
7. WHEN the detail page renders other-topic navigation THEN activating another topic SHALL navigate to that topic's `/theory/[topicId]` route.
8. WHEN the active language is switched while on `/theory/[topicId]` AND the current `topicId` does not resolve to an approved topic in the new language THEN the system SHALL render the not-found state (per 6.5), not crash.

### Requirement 7 — Responsive layout matching the prototypes

**User Story:** As a learner on either phone or desktop, I want the library to feel native to my device, so that browsing and reading are comfortable on both.

#### Acceptance Criteria

1. WHEN the viewport is mobile-width THEN the index SHALL render the mobile layout (stacked header, sticky-style search, horizontally scrollable group/sort chips, accordion-grouped list) consistent with the mobile prototype (section 11).
2. WHEN the viewport is desktop-width THEN the index SHALL render the desktop layout (wide header, search with ⌘K hint, segmented group/sort controls, card-framed grouped lists) consistent with the desktop prototype.
3. WHEN the detail page is viewed on mobile THEN the table of contents SHALL render as a horizontal tab strip and content SHALL render full-width, consistent with the existing `TheoryToc` mobile behavior.
4. WHEN the detail page is viewed on desktop THEN the table of contents SHALL render as a side rail alongside the scrollable content.
5. WHEN any layout renders THEN it SHALL use the existing design-system tokens and shell components (no ad-hoc colors or spacing outside the token system).

### Requirement 8 — Category taxonomy derived from the curriculum

**User Story:** As a maintainer, I want each topic's category to come from a single, curriculum-anchored source, so that grouping stays correct as the curriculum and generated topics evolve.

#### Acceptance Criteria

1. WHEN the category of a topic is needed THEN the system SHALL resolve it from the topic's `grammarPointKey` through a defined, versioned mapping that lives alongside the curriculum data, not hard-coded in the UI.
2. WHEN a grammar point has no assigned category THEN the resolver SHALL return a defined fallback category id so the topic still groups into "other" rather than being dropped.
3. WHEN the category taxonomy is defined THEN it SHALL provide a stable id, a display label, and a stable display order per category.
4. WHEN category resolution runs THEN it SHALL be language-agnostic at the type level (work for ES/DE/TR) even if the round-1 mapping only populates the currently active curriculum entries.

## Non-Functional Requirements

### Performance
- The index SHALL fetch the topic list through the existing TanStack Query layer with a stale time consistent with the current theory hooks (~5 minutes), so repeat navigation does not re-fetch unnecessarily.
- Grouping, sorting, and search filtering SHALL be computed client-side over the already-fetched list (no per-keystroke network requests).
- The list endpoint SHALL return the data the index needs (title, CEFR, category, curriculum order/grammar-point key) in a single request per language; category and curriculum-order resolution SHALL be performed server-side to avoid shipping curriculum data to the client.

### Security
- Both the list and detail data SHALL be served only through the existing authenticated theory endpoints (JWT-protected per-route), with no new unauthenticated surface.
- Only topics with an approved review status (`auto-approved` / `manual-approved`) SHALL be exposed, identical to current theory endpoint behavior.

### Reliability
- A corrupt or unparseable topic row SHALL NOT break the index: such rows SHALL be skipped (consistent with current list-endpoint filtering) and SHALL NOT prevent other topics from rendering.
- A detail-page fetch for a missing/unapproved topic SHALL resolve to the not-found state (treated as "no such topic"), not an unhandled error.
- Existing in-drill `TheoryTrigger`/`TheoryPanel` behavior SHALL remain unchanged; any change to the list endpoint contract SHALL be additive (new optional fields only).

### Usability
- The detail page SHALL be keyboard navigable and screen-reader friendly: the TOC items SHALL be focusable controls, the active section SHALL be conveyed, and the page SHALL have a single top-level heading for the topic title.
- Search SHALL be operable by keyboard alone, including focus (⌘K/Ctrl+K) and clear.
- All interactive controls (nav item, group/sort controls, topic rows, TOC items, back link) SHALL have accessible names.

### Maintainability / Testing
- The category taxonomy + mapping SHALL have unit tests asserting every populated `grammarPointKey` resolves to a known category and that the fallback is returned for unmapped keys.
- The enriched list endpoint SHALL have tests covering category/order enrichment and the skip-corrupt-row behavior.
- New api-client schemas/hooks and the index grouping/sort/search logic SHALL have unit tests; the page SHALL have at least one E2E happy-path (navigate to library → open a topic → land on detail → return) in the authenticated Playwright project.
