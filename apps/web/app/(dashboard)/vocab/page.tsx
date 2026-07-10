'use client';

import { useMemo } from 'react';
import { useAuth } from '@clerk/nextjs';
import { createAuthenticatedFetch, useVocabTopics } from '@language-drill/api-client';
import { useActiveLanguage } from '../../../components/shell/active-language-provider';
import { VocabTopicCard } from './_components/vocab-topic-card';
import { VocabListLoading, VocabListError, VocabEmpty } from './_components/vocab-list-states';

export default function VocabPage() {
  const { getToken } = useAuth();
  const { activeLanguage } = useActiveLanguage();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);
  const { data, isLoading, isError, refetch } = useVocabTopics({
    language: activeLanguage,
    fetchFn,
  });

  function renderBody() {
    if (isLoading) return <VocabListLoading />;
    if (isError) return <VocabListError onRetry={() => void refetch()} />;
    if (!data || data.topics.length === 0) return <VocabEmpty />;
    return (
      <div className="overflow-hidden rounded-lg border border-rule bg-card">
        {data.topics.map((topic) => (
          <VocabTopicCard key={topic.umbrellaKey} topic={topic} />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-s-5">
      <header className="vocab-library-header">
        <div className="t-micro">vocabulary coverage</div>
        <h1 className="t-display-xl" style={{ margin: '4px 0 0' }}>
          vocab.
        </h1>
        <p className="t-body-l" style={{ marginTop: 8, maxWidth: 680 }}>
          browse the words each topic covers and drill them.
        </p>
      </header>
      {renderBody()}
    </div>
  );
}
