# Cultural-issue rejection audit — 2026-07-11

_Source: prod Neon branch `br-green-waterfall-ancrvpr5` (project `twilight-smoke-01114337`),
`generation_jobs.rejection_reason_counts`, joined to Langfuse `validate`/`generate` traces
(project `cmp3aqkp207nkad07h6t99fi1`) for the reason prose + paired draft text._

## What this is

An audit of every exercise draft the generation validator rejected on a **cultural
issue** over the month **2026-06-08 → 2026-07-11**. The goal: catalogue what actually
triggers the veto, break it down by language and theme, and decide whether the
generation prompt's "safe topics" guidance has a systematic gap.

## Mechanism (why these are recoverable only from traces)

In `routeValidationResult` (`packages/db/src/generation/routing.ts`), a **non-empty
`culturalIssues` array is a hard veto** — the draft routes to `rejected` regardless of
`qualityScore`, same tier as `contextSpoilsAnswer`. It is **never** flagged for review;
the draft is discarded and no `exercises` row is written. The only persisted trace in
Postgres is an **aggregate count** — `generation_jobs.rejection_reason_counts →
{'cultural-issue': N}` (keyed by the reason *code*, `GenerationReasonCode.CulturalIssue`,
not the prose). The reason text and the offending draft survive only in the Langfuse
`validate` / `generate` observations.

## Scale & framing

- **80 cultural rejections across 74 cells** over the month.
- **None ever reached a user** — every one was rejected pre-storage. This is about
  **wasted generation spend and defense-in-depth**, not a live content leak.
- Roughly **half also scored `qualityScore < 0.5`** independently, so the cultural flag
  was frequently redundant with a quality veto.
- The validator is working. The question is whether tightening *generation* would cut the
  waste and add a second layer of safety.

## Breakdown by theme

Counts are approximate (some drafts hit two themes); representative drafts are quoted
verbatim from the traces.

| Theme | ~count | Representative verbatim draft | Covered by current prompt? |
|---|---|---|---|
| Crime / violence / policing / war / torture | ~16 | *"Fue el prisionero quien más fue torturado durante el interrogatorio."* · *"The soldiers promised that they would not kill any civilians during the operation."* · *"Si no queremos ir a la cárcel, salgamos de este lugar antes de que llegue la policía."* · TR *çatışmak* (neighbours clashing), *ihlal etmek* (ceasefire violation) | Partially ("violence") |
| Ethnic slurs / vulgar pejoratives (**seed-driven**) | ~9 | *Çingene* (Romani slur) ×2 · *Kızılderili* (Native American) · *hatun* (derogatory "woman") · *aptal* ("stupid") ×2 · *kıç* (vulgar "butt") ×3 — *"Geminin kıçı çok büyük"* | ❌ |
| Death / morbid / accidents / illness | ~7 | *"Bu bir ceset değil"* (corpse) · *"Siz bu gece ölmüyorsunuz"* (dying tonight) · *"Hay un accidente terrible delante del hospital"* · grandparent-death-plus-inheritance | ❌ |
| Weapons / firearms | ~7 | *pistola* ×5 (*"La pistola está en la mesa"*) · *"La bomba está en la mochila"* · *disparar* | ✓ (yet still leaks) |
| Sexual content / false-friends / adult content | ~7 | *sevişmek* ("make love") ×2 · *violar* (Sp. = "to rape") · *"una película para adultos"* · *"nada pervertido delante de los niños"* · *sujetador* (bra) mistranslating "brace" | ❌ |
| Jewish-identity othering + *judío/judías* error | ~6 | *"los judíos con tomate"* / *"judíos verdes"* (masc. form reads "Jews with tomato" instead of green beans) · *"mi vecino judío"* · *"no hay ningún plato judío"* | Partially ("stereotyping") |
| Religious incongruity for the learner's culture | ~7 | TR *kilise/rahip* (church/priest) ×4 · *Mesih* (Messiah) · *Noel* (Christmas as a foreign holiday) · ES right-hand drinking etiquette | ❌ |
| Bullfighting (culture-divisive) | ~5 | *torero, corrida, cogida, faena* across five ES B2 cells | ❌ |
| Mental health / depression | ~4 | *"...cómo tratar tu depresión"* · *"Debes de estar pasando por una depresión"* | ❌ |
| Value-laden / identity stereotypes | ~7 | motherhood-as-highest-calling ×2 · British-tea · patriarchal "head of household" · master/*doncella* class · LGBTQ+ *"lezbiyen olarak"* / coming-out ×2 | Partially |

## Breakdown by language

The two languages have **distinct risk profiles**, which matters for the fix.

**Spanish (~50 rejects).** Firearms (*pistola*), bullfighting, the *judío/judías* cluster,
crime/police/incarceration, depression, vulgar insults (*gilipollas*), and the *violar*
false-friend. Skews toward **A2 firearms** and **B2 bullfighting/torture**.

**Turkish (~30 rejects).** Church/priest incongruity, death/morbidity at A1, ethnic slurs
(*Çingene, Kızılderili*), vulgar/sexual **seed words** (*kıç, aptal, sevişmek*),
foreign-holiday framing (*Noel*), and LGBTQ+ sensitivity (sharper in the TR societal
context). Skews toward **A1 seed-word vulgarity** and **religious framing**.

## The key structural finding: two failure modes

The current safe-topics rule addresses only the first of two distinct paths:

1. **Sentence-topic choice** (bullfighting, depression, torture, migration) — the writer
   picks a charged scenario. A prompt tweak helps here.
2. **Seed-lemma injection** (*violar, sevişmek, aptal, kıç, matar, asesinar, castigar,
   hatun*) — for `conjugation` and `vocab_recall` cells the target lemma comes from the
   **frequency band / curated seed list**, so the model is *handed* the offensive word and
   builds a sentence around it. A safe-topics instruction cannot fix this — the word is a
   required input. Same class as the existing conjugation-seed and vocab-lemma-seeding
   notes.

## Gap analysis vs. `packages/ai/src/generation-prompts.ts:390`

Current guidance (single line):

> **Safe, neutral topics.** Avoid weapons/explosives (e.g. `bomba`), alcohol and other
> substances, violence, and culturally-sensitive or stereotyping topics. Prefer neutral
> everyday contexts: home, food, daily routine, travel, weather, study/work.

Gaps:

- **Weapons are named yet still leak** — `pistola` ×5 despite `bomba` being the example.
  One example is insufficient anchoring.
- **Six categories are entirely absent:** death/illness, sexual content, religion &
  religious incongruity, crime/policing/incarceration, mental health, and named
  culture-divisive topics (bullfighting).
- **"Stereotyping" is too abstract** to catch ethnic-identity-as-descriptor
  (`vecino judío`) or value-laden claims (motherhood-as-highest-calling).
- **Nothing addresses the seed-lemma path** (failure mode #2) at all.

## Recommended fix (two-pronged)

1. **Expand the safe-topics line** into an explicit denylist with per-category examples:
   weapons *(pistola, arma)*, death/illness/injury, crime/police/prison/migration,
   torture/war, sexual content, religion & religious figures, ethnic/national/religious
   identity as a descriptor, profanity/insults, and named culture-divisive topics
   (bullfighting). Add a positive rule: *do not tag characters by ethnicity, religion, or
   sexual identity unless the grammar point requires it.*
2. **Add a seed-lemma denylist** filtering the frequency-band + curated conjugation/vocab
   seed pools (drop *violar, matar, asesinar, castigar, disparar, sobornar, aptal, kıç,
   hatun, sevişmek, ölmek/ölüm, çatışmak*, etc.). This is the only thing that closes
   failure mode #2. Each candidate lemma should be verified against the actual
   frequency/seed source files before removal.

Both changes require the `GENERATION_PROMPT_VERSION` bump + Langfuse `push-prompts` sync
per `CLAUDE.md`. Because seed suppression is curriculum-adjacent, confirm whether a
`CURRICULUM_VERSION` bump is needed for the change to take effect on the next scheduler
run (a prompt-only fix to a suppressed cell will not re-run on its own).

## Reproducing this audit

```sql
-- Cells that recorded a cultural-issue rejection, newest first
SELECT cell_key,
       (rejection_reason_counts->>'cultural-issue')::int AS n,
       finished_at
FROM generation_jobs
WHERE rejection_reason_counts ? 'cultural-issue'
ORDER BY finished_at DESC;
```

The reason prose + paired draft are then recovered per cell from Langfuse: filter
`GENERATION` observations on `metadata.cellKey = <cell_key>` within the run's time window,
read each `validate` observation's `culturalIssues` array, and match it to the sibling
`generate` observation by draft content (note: in this pipeline `generate` and `validate`
do **not** share a `traceId`).
