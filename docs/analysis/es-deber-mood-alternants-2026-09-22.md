# es-b1-deber-obligation-probability — enumerate the indicative alongside the conditional

**Date:** 2026-09-22 · **Neon branch:** `br-green-waterfall-ancrvpr5` (production)

## The defect

The point drills what *deber* MEANS (obligation vs. probability), not which mood
it takes. On an advice stem nothing forces the hedged conditional, so the plain
indicative is equally correct and a lone `correctAnswer` is a false-negative
trap:

```
Llevas horas trabajando sin parar. ___ tomar un descanso.   → "Deberías"
                                                              "Debes" fits identically
```

This is the same family as tense- and polarity-determinacy (#611 / #633), but
the cure is the **opposite**: `debes` and `deberías` are not antonyms or
different times — both are correct realizations of the same task, differing only
in directness. So enumeration IS the right fix here, and the generation prompt
already requires it ("Do not ship a lone `correctAnswer` when the context admits
synonyms or **alternative inflections**"). It was simply applied inconsistently:
**2 of 10** approved rows already listed the indicative. This brings the other 8
into line rather than adding a new rule for something already ruled on.

Not changed, and reported separately: 4 rows on this point answer `podría` /
`podrían`, which is *poder*, not *deber* — a possible grammar-point drift worth
its own look.

## Rollback

All 8 rows had `acceptableAnswers` **absent** (`null`) before this edit:

```sql
UPDATE exercises
SET content_json = content_json - 'acceptableAnswers'
WHERE id IN (
  '0bd7fea8-4fc1-55fa-80b9-34d646d312ff','0ed80361-cea4-5835-bfb9-3339c37d398c',
  '1c8afa03-50f9-566b-9adc-f8578e7b606a','249a1125-9b53-57ad-a2d7-bd51073c792c',
  'a4a406a1-16b0-59bf-854e-d5d359516772','ab0a1d44-f7d2-598a-9870-d8961999c2d7',
  'ac929878-71b3-57f8-9ad0-2bc49f94f309','ad929a0b-f2d0-55bd-9bd0-2d611e785538'
);
```

## Rows edited

| id | correctAnswer | added | person |
|---|---|---|---|
| `0bd7fea8` | Deberías | Debes | 2sg |
| `0ed80361` | Deberías | Debes | 2sg |
| `1c8afa03` | Debería | Debo | **1sg** — "Ayer rompí el vaso… ___ tener más cuidado" |
| `249a1125` | Deberías | Debes | 2sg |
| `a4a406a1` | deberías | debes | 2sg |
| `ab0a1d44` | deberías | debes | 2sg |
| `ac929878` | deberías | debes | 2sg — "no ___ rendirte" → "no debes rendirte" |
| `ad929a0b` | Deberías | Debes | 2sg |

Already correct, untouched: `1f9a0946` (`Debes`), `219a0c6c` (`debes`).
