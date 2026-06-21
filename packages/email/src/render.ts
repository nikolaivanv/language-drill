import type { ReactElement } from 'react';
import { render } from '@react-email/components';

/**
 * Render a React Email element to both an HTML body and a plain-text fallback.
 * Both parts are handed to Resend so clients that block HTML still get content.
 */
export async function renderEmail(
  node: ReactElement,
): Promise<{ html: string; text: string }> {
  const html = await render(node);
  const text = await render(node, { plainText: true });
  return { html, text };
}
