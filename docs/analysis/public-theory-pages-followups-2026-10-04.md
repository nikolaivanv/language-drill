# Public theory pages — what shipped, what was left, and one production finding

Companion to `docs/superpowers/specs/2026-10-04-public-theory-pages-design.md` and
`docs/superpowers/plans/2026-10-04-public-theory-pages.md`. Written at the end of the
branch so the decisions and the leftovers outlive the scratch workspace.

---

## The one thing to act on independently of this branch

**`robots.txt` and `sitemap.xml` were never publicly reachable in production, and
had not been since they were added.** `apps/web/proxy.ts`'s `config.matcher`
excludes `.css`, `.js`, `.png`, `.svg`, `.webmanifest` and a dozen other
extensions — but not `.xml` or `.txt`. So Clerk's middleware ran on both files,
neither was in `isPublicRoute`, and `auth.protect()` took them.

Measured against production on 2026-10-04, before the fix:

```
curl -H 'Accept: text/html' https://www.langdrill.app/sitemap.xml
  → 307 https://accounts.langdrill.app/sign-in?redirect_url=…%2Fsitemap.xml
curl https://www.langdrill.app/robots.txt
  → 404   (Clerk's non-document rewrite)
x-clerk-auth-reason: protect-rewrite, session-token-and-uat-missing
x-clerk-auth-status: signed-out
```

Consequences that predate this work: Google has never been able to fetch the
sitemap, so the seven existing public URLs were only ever discoverable by
following links; and because `robots.txt` was unreachable too, the `Sitemap:`
directive inside it was unreachable as well.

Fixed here by adding both paths to `isPublicRoute`. **Worth confirming on the
first production deploy** that `https://www.langdrill.app/sitemap.xml` returns 200
with XML, and then submitting it in Search Console — the fix is necessary but not
sufficient, since the sitemap has never been submitted while it was unreachable.

The structural reason this survived nine task reviews and a whole-branch review:
the filesystem-derived middleware guard walks `page.tsx` files, so it could not
see metadata routes at all. That gap is now closed by a sibling guard which
enumerates file-based metadata conventions and parses the matcher's own
extension-exclusion list programmatically rather than hand-copying it.

---

## Deltas from the spec, as shipped

| Spec | As shipped | Why |
|---|---|---|
| §A `hasConjugationDrill` is both conditions server-side | The level condition is enforced in `fetchConjugationDrillKeys`; the index's pill also narrows client-side via `publicLevelFor` | Equivalent in effect — verified zero over-promising pills across all approved rows |
| §A the topic's `grammar_point_key` | Now the **column**, after initially using `content_json.id` | One production row disagrees (`b1-comparatives-superlatives`: column `es-a2-…`, content id `es-b1-…`) and all 64 of its approved exercises sit under the column key. `content_json.id` is generator output that goes stale when a point is re-levelled. |
| §B "the build makes no API calls"; ISR absorbs read volume | The three hubs and `sitemap.xml` are `force-dynamic`, so they make a **live API call per request** | Next prerendered them at build, which coupled the build to a live API — and Vercel Preview points `NEXT_PUBLIC_API_URL` at the **production** API, so a prod blip could fail an unrelated PR's build. `force-dynamic` does **not** preserve the fetch cache in Next 16.3.3 (confirmed from the docs and from a `no-store` response header), so the dead `revalidate` export was removed. Topic pages remain fetch-cached for an hour. |
| §C the article reuses `TheorySections` | `GrammarTopic` renders its sections directly | `TheorySections` wraps children in a class-based React error boundary, which cannot be a Server Component. Every earlier consumer reached it through a `'use client'` ancestor, which masked that for as long as no pure server component used it. ~8 lines of markup are duplicated; the CSS stays shared; a comment names the constraint. |
| §C hero pills and chrome | No `data-active="grammar"` (no such prop on `PublicHeader`); hero eyebrow lacks the category label and the "Free conjugation drill" pill; related cards lack a per-card drill line; no separate sign-up band beyond the rail box | Cosmetic, deferred |
| §D sticky level rail on the hub | **Not implemented** | The one functional gap against the prototype. Grouping, counts, the drill pill and search are all present. |
| §E quick check | As specified, plus a `QUICK_CHECK_SIZE * 2` fetch window so one malformed row cannot suppress a topic's check | Hardening; measured zero malformed rows in the first six candidates of any topic today |

## Measured facts worth keeping

Production, 2026-10-04:

- **312 approved topics** — ES 119, DE 104, TR 89. One row per `(language, topic_id)`; zero corrupt.
- **38 of 312** have an approved conjugation pool at a level the public drill offers (ES 12, DE 10, TR 16). The index's per-topic pill is therefore load-bearing: a topic page must never promise a drill without `hasConjugationDrill`.
- **215 of 312** can supply three option-free cloze rows for a quick check. Of the rest, 25 have only one or two and 72 have none at all (TR 32, DE 27, ES 13).
- **10 `topic_id` values collide across languages** (`a1-numbers-ordinals` exists in all three), which is why every public URL carries the language.
- **Zero unsupported block or inline kinds** across all 312 topics in all three languages — every `kind` is one of the ten the renderer handles, so `renderTheoryTopicJson` cannot hit an unknown-kind path. Structurally invalid content is rejected upstream by `parseTheoryTopicJson` as a deliberate 500.
- Validator `quality_score` averages 0.926 ES / 0.920 DE / 0.904 TR, with 6 rows below 0.80 (1 DE, 5 TR).

The dev Neon branch differs and will mislead anyone verifying locally: **ES 114, TR 67, DE zero**. An empty `/german/grammar` locally is expected.

## Carried follow-ups

Ordered roughly by value.

1. **Submit the sitemap in Search Console** once a production deploy confirms `/sitemap.xml` returns 200. It has never been submitted because it was never fetchable.
2. **The hub's sticky level rail** (§D) — the only functional gap vs the prototype, and the most useful thing on a 119-item list.
3. **Mobile TOC** renders after the full article, so a reader meets it only after scrolling past everything it indexes. The prototype hid the TOC below 1120px; that is roughly a one-line fix and probably the better design.
4. **Hero/chrome polish** (§C): category label and free-drill pill in the eyebrow, per-card drill line on related cards, a sign-up band.
5. **Article line length** — the prose column has no explicit `max-w` and runs ~780–800px, past the usual 65–75ch. Other public pages use 640px and 860px.
6. **The hub search uses a global `document.querySelectorAll`** rather than scoping to its own container. Harmless with one index per page.
7. **The non-JSON response branch** in `lib/public-theory.ts` has no dedicated test; it throws by the same path as the tested network-failure branch.
8. **The sitemap's duplicate-URL test** mocks one topic per language, so it cannot catch a same-language id collision.
9. **`exercise-filters.ts`'s header comment** enumerates `approvedStatusFilter`'s call sites and was not extended with `theory-practice.ts`'s two.
10. **Richer theory blocks.** Roughly half the prototype's topic-page furniture — the two-column TL;DR, signal-word chips, meaning-shift cards, mistake pairs — has no block kind in the theory taxonomy. Adding them means new kinds in `packages/shared`, parser changes, a `THEORY_GENERATION_PROMPT_VERSION` bump, the matching validation bump, a Langfuse push, and regenerating all 312 topics. Decide from Search Console which pages earn it rather than doing it blind.
11. **The public test session** (`/es/try` in the prototype) remains unspecified work: anonymous AI spend has no per-visitor limiter here, since metering is keyed on `userId` and the gateway throttle is one shared bucket.

## Risks that remain live

- **The public throttle is shared.** 20 rps / 50 burst across all anonymous callers, and the hubs plus sitemap now hit the API per request. Watch the prod 4xx alarm after the first crawl.
- **308 of 312 pages are LLM-generated and human-unread.** That is the policy class Google's scaled-content-abuse rules target; it survives on being genuinely useful and attached to a working practice product. The first mitigation is editorial: read the pages that get traffic.
- **The public article has no error boundary, by design.** A render error is a 500 rather than a 200 carrying an empty article, because the latter is thin content that gets indexed.
