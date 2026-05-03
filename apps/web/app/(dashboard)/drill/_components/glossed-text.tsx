'use client';

import React, { Fragment, type ReactNode } from 'react';

import { lookupGloss } from '../../../../lib/translation/gloss-en';

export interface GlossedTextProps {
  text: string;
}

export function GlossedText({ text }: GlossedTextProps): ReactNode {
  if (text === '') {
    return null;
  }

  const tokens = text.split(/(\s+)/);

  return (
    <>
      {tokens.map((token, index) => {
        const entry = lookupGloss(token);
        if (entry) {
          return (
            <span key={index} className="gloss" tabIndex={0}>
              {token}
              <span className="gloss-tooltip">{entry.gloss}</span>
            </span>
          );
        }
        return <Fragment key={index}>{token}</Fragment>;
      })}
    </>
  );
}
