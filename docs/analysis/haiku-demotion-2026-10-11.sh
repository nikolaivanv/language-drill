#!/usr/bin/env bash
# Demote the cloze / vocab_recall / sentence_construction rows Haiku 5.5
# generated on 2026-10-11 (#780; reverted to Sonnet in #781). See
# docs/analysis/haiku-demotion-2026-10-11.tsv for the captured worklist.
#
#   bash docs/analysis/haiku-demotion-2026-10-11.sh export   # read-only: capture ids
#   bash docs/analysis/haiku-demotion-2026-10-11.sh dry-run  # per-cell dry runs
#   bash docs/analysis/haiku-demotion-2026-10-11.sh apply    # write
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
TSV=docs/analysis/haiku-demotion-2026-10-11.tsv
PROD=$(aws --region eu-central-1 secretsmanager get-secret-value \
  --secret-id language-drill/DATABASE_URL --query SecretString --output text)

case "${1:-}" in
  export)
    psql "$PROD" -At -F $'\t' -c "
      select id, language, difficulty, type, grammar_point_key
      from exercises
      where model_id = 'claude-haiku-5-5'
        and type in ('cloze', 'vocab_recall', 'sentence_construction')
        and review_status in ('auto-approved', 'manual-approved')
        and created_at >= '2026-10-11'
      order by language, difficulty, type, grammar_point_key, id" > "$TSV"
    echo "captured $(wc -l < "$TSV") rows into $TSV"
    cut -f2-5 "$TSV" | sort | uniq -c
    ;;
  dry-run|apply)
    flag=""; [ "$1" = apply ] && flag="--apply"
    tmp=$(mktemp -d)
    cut -f2-5 "$TSV" | sort -u | while IFS=$'\t' read -r lang lvl typ gp; do
      awk -F'\t' -v l="$lang" -v c="$lvl" -v t="$typ" -v g="$gp" \
        '$2==l && $3==c && $4==t && $5==g {print $1}' "$TSV" > "$tmp/ids.txt"
      echo "=== $lang $lvl $typ $gp ($(wc -l < "$tmp/ids.txt") ids)"
      DATABASE_URL="$PROD" pnpm --silent --filter @language-drill/db demote:pool \
        --language "$lang" --cefr "$lvl" --type "$typ" --grammar-point "$gp" \
        --ids-file "$tmp/ids.txt" --reason pool-hygiene $flag 2>&1 | tail -4
    done
    rm -rf "$tmp"
    ;;
  *) echo "usage: $0 export|dry-run|apply"; exit 2 ;;
esac
