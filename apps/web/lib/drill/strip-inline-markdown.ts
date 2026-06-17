/**
 * Strip asterisk markdown emphasis (`**bold**`, `*italic*`) that the content
 * generator occasionally leaks into plain-text exercise fields (most visibly
 * the sentence-construction `prompt`, where keywords get bolded). The drill UI
 * renders these fields verbatim — there is no markdown renderer — so the
 * markers would otherwise show as literal asterisks.
 *
 * Conservative by design: it collapses *paired* asterisk emphasis and keeps the
 * inner text, while leaving unpaired/stray asterisks (e.g. "2 * 3") untouched.
 * Underscores are intentionally left alone to avoid mangling snake_case tokens;
 * extend here if the generator starts leaking `_emphasis_`.
 */
export function stripInlineMarkdown(text: string): string {
  return text
    .replace(/\*\*([^*]+?)\*\*/g, '$1')
    .replace(/\*([^*]+?)\*/g, '$1');
}
