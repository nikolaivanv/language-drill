# Frequency-corpus data sources

This document records the external corpora used to build the per-language
frequency dictionaries shipped in `@language-drill/ai/frequency`. Each entry
lists where the corpus was downloaded, its license, the one-line conversion
recipe that produces the matching TSV, and the date the snapshot was taken.

## Pipeline overview

```
raw corpus  ──[ maintainer conversion ]──►  packages/ai/scripts/sources/{lang}.tsv
                                                          │
                                       pnpm --filter @language-drill/ai build:frequency
                                                          ▼
                                            packages/ai/src/frequency/{lang}.json
```

- **Raw corpus**: large, license-encumbered, lives on the maintainer's
  machine only. Not checked into git.
- **TSV** at `packages/ai/scripts/sources/{lang}.tsv`: tab-delimited rows of
  `surface_form<TAB>lemma<TAB>rank[<TAB>cefr]`, ignored by git
  (`packages/ai/.gitignore`).
- **JSON** at `packages/ai/src/frequency/{lang}.json`: produced by the build
  script (see `packages/ai/scripts/build-frequency.ts`), capped at 50_000
  entries per language. **These ARE committed.**

The TSVs stay local because (a) the raw corpora are usually too large to
sit in the repo, (b) some licenses prohibit redistribution of the source
even though derived statistics are fine, and (c) the JSON outputs are the
only thing the Lambda actually loads.

## License requirement

**Every corpus selected MUST be redistributable as derived frequency data,
or in the public domain.** Verify by reading the upstream license before
adding an entry. If a corpus's license forbids redistributing derived word
frequencies, do not use it — find an alternative.

The committed `{lang}.json` files are derived data, which is the form that
will be shipped inside the Lambda bundle.

## Per-language sources

### Spanish (ES)

- **Suggested corpus**: OpenSubtitles ES surface-form frequency list
- **URL**: (https://github.com/hermitdave/FrequencyWords/blob/master/content/2018/es/es_50k.txt)
- **License**: CC-by-sa-4.0
- **Snapshot date**: 2026-05-12
- **Conversion notes**: Python scripts/build_lemma_ranks.py + spaCy es_core_news_sm (nlp.pipe lemmatization), subtitle counts summed per lemma, competition-ranked, one TSV row per surface (with header).

### German (DE)

- **Suggested corpus**: OpenSubtitles DE surface-form frequency list
- **URL**: https://github.com/hermitdave/FrequencyWords/blob/master/content/2018/de/de_50k.txt
- **License**: CC-by-sa-4.0
- **Snapshot date**: 2026-05-12
- **Conversion notes**: Same script + spaCy de_core_news_sm; surfaces str.lower(), lemmas unchanged from the model (German noun/proper-noun capitals preserved)

### Turkish (TR)

- **Suggested corpus**: OpenSubtitles TR surface-form frequency list
  invokeit.wordpress.com or a community-published derivative)
- **URL**: https://github.com/hermitdave/FrequencyWords/blob/master/content/2018/tr/tr_50k.txt
- **License**: CC-by-sa-4.0
- **Snapshot date**: 2026-05-12
- **Conversion notes**: Same script + Zemberek via zemberek-python (TurkishMorphology.create_with_defaults(), analyze_and_disambiguate per token, morph fallback if empty); surfaces TurkishMorphology.normalize_for_analysis, same aggregate + rank + TSV layout.

## TSV format reference

`packages/ai/scripts/build-frequency.ts` expects:

```
surface_form<TAB>lemma<TAB>rank[<TAB>cefr]
```

- **`surface_form`**: lowercased; rows containing internal whitespace are
  skipped by the build script.
- **`lemma`**: dictionary headword (verb infinitive, masculine singular
  adjective, singular noun). For DE, keep the standard noun capitalization
  on the lemma but lowercase the surface form.
- **`rank`**: positive integer; lower = more frequent.
- **`cefr`** (optional): one of `A1`, `A2`, `B1`, `B2`, `C1`, `C2`. Any
  other value is dropped silently. Leave the column blank when unknown.
