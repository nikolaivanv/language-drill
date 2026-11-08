# TR A1 demonstratives — in-place repair of one cloze row (2026-11-07)

Prod row `829644db-528f-526b-8944-85076f811522` (`tr-a1-demonstratives`, cloze,
auto-approved 2026-08-18, quality 0.82). Learner-reported.

**Defect:** `___ ofise her gün geliyorum.` keyed `Buraya`. The dative locative
pronoun cannot precede a dative-marked noun (`*Buraya ofise`); the blank needs
the demonstrative determiner `Bu`, which was not among the options. The gloss
("this place (the office)") was bent to fit the wrong key.

Sibling check: the other 8 approved demonstratives clozes keyed on a
bura-/şura-/ora- form all use it pronominally (subject or bare goal) — no
other row has this defect.

## Change

| field | before | after |
|---|---|---|
| `correctAnswer` | `Buraya` | `Bu` |
| `options` | `["Buraya","Burada","Burası","Bunu"]` | `["Bu","Buraya","Burası","Bunu"]` |
| `glossEn` | `I come to this place (the office) every day.` | `I come to this office every day.` |

`review_status` left `auto-approved`; `sentence` / `_dedupKey` unchanged.

## Rollback

```sql
UPDATE exercises
SET content_json = content_json
  || '{"correctAnswer":"Buraya","options":["Buraya","Burada","Burası","Bunu"],"glossEn":"I come to this place (the office) every day."}'::jsonb
WHERE id = '829644db-528f-526b-8944-85076f811522';
```
