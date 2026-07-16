import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RelatedTopics } from '../related-topics';
import type { RelatedTheoryTopics } from '@language-drill/api-client';

const RELATED: RelatedTheoryTopics = {
  buildsOn: [{ topicId: 'b1-conditional', title: 'Conditional simple', cefr: 'B1' }],
  leadsTo: [
    { topicId: 'b2-remote-conditionals', title: 'Remote conditional sentences', cefr: 'B2' },
  ],
  siblings: [
    { topicId: 'a2-si-present-conditional', title: 'Open conditions with si + present', cefr: 'A2' },
  ],
};

const EMPTY: RelatedTheoryTopics = { buildsOn: [], leadsTo: [], siblings: [] };

describe('RelatedTopics', () => {
  it('renders the three tier headings and one chip per ref', () => {
    render(
      <RelatedTopics
        related={RELATED}
        categoryLabel="moods & conditionals"
        onSwitchTopic={vi.fn()}
      />,
    );
    expect(screen.getByText('related topics')).toBeInTheDocument();
    expect(screen.getByText('builds on')).toBeInTheDocument();
    expect(screen.getByText('leads to')).toBeInTheDocument();
    expect(screen.getByText('more in moods & conditionals')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Remote conditional sentences/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Conditional simple/ })).toBeInTheDocument();
  });

  it('navigates via onSwitchTopic with the topic slug on click', async () => {
    const onSwitchTopic = vi.fn();
    render(
      <RelatedTopics related={RELATED} categoryLabel={null} onSwitchTopic={onSwitchTopic} />,
    );
    await userEvent.click(
      screen.getByRole('button', { name: /Remote conditional sentences/ }),
    );
    expect(onSwitchTopic).toHaveBeenCalledWith('b2-remote-conditionals');
  });

  it('hides empty tiers and falls back to a plain "related" heading without a category label', () => {
    render(
      <RelatedTopics
        related={{ ...EMPTY, siblings: RELATED.siblings }}
        categoryLabel={null}
        onSwitchTopic={vi.fn()}
      />,
    );
    expect(screen.queryByText('builds on')).not.toBeInTheDocument();
    expect(screen.queryByText('leads to')).not.toBeInTheDocument();
    expect(screen.getByText('related')).toBeInTheDocument();
  });

  it('renders nothing when every tier is empty', () => {
    const { container } = render(
      <RelatedTopics related={EMPTY} categoryLabel="moods & conditionals" onSwitchTopic={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
