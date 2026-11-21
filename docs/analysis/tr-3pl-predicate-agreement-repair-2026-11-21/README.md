# TR 3pl predicate agreement — evaluator defect + prod repair (2026-11-21)

## The defect

A learner translated **"They are not cleaning the room."** as

> Onlar odayı temizlemiyor.

and was scored **0.8** with a minor grammar error, `temizlemiyor → temizlemiyorlar`,
explained as:

> With the explicit plural subject 'Onlar' (they), the verb needs the plural personal
> suffix -lar to agree […] Without it, the verb defaults to 3rd person singular,
> mismatching the plural subject.

The answer is fully correct Turkish, and the rule as stated is **inverted**.

Göksel & Kerslake, *Turkish: A Comprehensive Grammar*:

- **§12.2.1** — "Where a 3rd person plural subject **is not expressed by an overt noun
  phrase**, and the referents are animate, plural marking of the predicate is
  obligatory" (`Bodrum'a gittiler.`).
- **§12.2.2.1 (i)** — with an overt plural-marked human subject, "plural marking of the
  predicate is **optional** but common" (`Bazı arkadaşlarımız bu fikre katılmadı(lar).`).
  The difference is nuance: `-lAr` individuates the participants, the bare form treats
  the event as a whole.
- The first example sentence of the pronouns chapter (**§18, ex. 1**) is
  `Onlar eşyalarını daha toplamamış.` — overt `onlar`, unmarked predicate.
- **§22, ex. 34a** writes the suffix as optional in the gloss itself:
  `Onlar doktormuş(-lar).`

So an overt `Onlar` is what *licenses dropping* `-lAr`, not what forces it. The
secondary claim — that the unmarked verb "reads as 3rd person singular" — is also
false: with an overt plural subject the unmarked predicate is number-neutral.

Same family as **#812** (`onların kapısı` keyed `kapıları`): the evaluator
over-applying `-lAr` agreement to `onlar`. That one was possessive morphology; this is
predicate agreement.

## Live repro (paired, Langfuse unset so the in-repo fallback is used)

Real `evaluateAnswer` against the prod exercise `65a3b149-…`, `VALIDATION`-free path,
Sonnet 5 evaluator, temperature 0.

| answer | baseline `evaluate@2026-11-11` | candidate `evaluate@2026-11-21` |
|---|---|---|
| `Onlar odayı temizlemiyor.` (the learner's) | **0.6 / 1.0 / 0.75** (3 runs) | **1.0 / 1.0 / 1.0** |
| `Onlar odayı temizlemiyorlar.` (reference) | 1.0 | 1.0 |
| `Odayı temizlemiyor.` (subject dropped → `-lAr` really is required) | 0.55 | 0.55 |

The baseline is *flaky*, not uniformly wrong — it marked the answer correct 1 time in 3.
That is why the defect survived: it does not reproduce reliably.

(A fourth probe, `Çocuklar odayı temizlemiyor.`, scores 0.6–0.75 in **both** arms with
`Çocuklar → Onlar` — the evaluator objecting to substituting "the children" for "they"
in a translation, with `grammarAccuracy` 1.0. That is a faithfulness call on a badly
chosen probe, not the agreement axis, and it is unchanged by this fix.)

## Code changes

- `packages/ai/src/prompts.ts`
  - TR language note **Predicate plural agreement** (system prompt — needs a Langfuse
    push per env after merge).
  - `buildTranslationUserPrompt`'s optional-elements paragraph now lists the `-lAr`
    suffix, and the pro-drop pronoun list gained `onlar` (it had `ben/sen/o/biz/siz`
    only). Ships with the Lambda; no Langfuse push.
  - `EVALUATION_SYSTEM_PROMPT_VERSION` → `evaluate@2026-11-21`.
- `packages/ai/src/prompts.test.ts`, `packages/ai/src/evaluate.test.ts` — version
  assertions plus four new tests.

**Not changed, deliberately:**

- *Curriculum* — it is already right. `tr-a1-personal-suffixes` documents
  "3pl -lAr (optional, human only)" with a matching `commonError`, and
  `tr-a1-present-continuous` carries `Çocuklar bahçede oynuyor.` as a positive example.
  No TR point asserts the wrong rule.
- *Theory pages* — also already right. The `tr-a1-personal-suffixes` page has a warn
  callout, "3rd person plural -lAr is for people only, and optional even then", and a
  `doktor(lar)` row in its table. A scan of all TR pages for an "obligatory / must add"
  claim near a plural subject returned nothing.
- *Generation prompt* — see **Follow-up** below.

## Prod repair (applied 2026-11-21, before merge)

Branch `production` / `br-green-waterfall-ancrvpr5`, via the Neon MCP.

1. **56 approved rows** gained the counterpart form in `acceptableAnswers`
   (35 cloze + 21 translation): every approved TR row whose keyed answer is a predicate
   carrying 3pl `-lAr` over an **overt human plural subject**, and which did not already
   list the unmarked form. Rows already listing both were left alone. `before.json`
   holds each row's prior `acceptableAnswers` and a `content_json` md5 for rollback;
   `apply.sql` is the statement as run (idempotent — the `?` guard skips a value that is
   already present).

   Excluded on purpose:
   - `0e13e0e8…` — `karakterler` is a plural **noun**, not predicate agreement.
   - `24236c39…` (`Onlar şarkı değil.`) — non-human subject, so `-lAr` would be *wrong*;
     the row is already keyed correctly.

2. **Two learner attempts re-scored to 1.0**, their `errors` cleared and their
   `error_observations` row deleted:
   - `a339a209-…` 2026-11-21, 0.8, `Onlar odayı temizlemiyor.` (the reported one;
     observation `8f5e1d62-…` attributed to `tr-a1-personal-suffixes`)
   - `a2de6f2b-…` 2026-06-17, 0.85 **major**, `Onlar partide çok gülecek.` on
     `Onlar partide çok gülecekler.` (observation `8b922093-…`, host `tr-a1-future`).
     Found by sweeping `error_observations` for `correction = wrong_text || lAr`; that
     sweep returned 6 TR rows and these were the only two of this class — the other
     four are genuine missing noun plurals. The exercise itself is already `rejected`,
     so it took no `acceptableAnswers` patch.

3. **Mastery** — not rebuilt by hand. The nightly `backfill:mastery` Lambda (03:00 UTC)
   replays host history plus incidental error observations, so both corrections land on
   the next run.

## Follow-up (not in this PR)

`generation-prompts.ts` has a **Turkish personal/copular-suffix clozes** rule that
already says "3pl -lAr is optional and HUMAN-only" and requires `acceptableAnswers` to
list both forms — but it is scoped to the *copular* point. There is no verbal analogue,
which is why 35 cloze rows shipped keyed `-lAr`-only. Adding one is a
`GENERATION_PROMPT_VERSION` bump plus a mirrored validator change, and wants an
`eval:gen` run; it is also **inert today**, since prod exercise generation has been
paused since 2026-10-21 (#801). Worth doing before generation resumes.
