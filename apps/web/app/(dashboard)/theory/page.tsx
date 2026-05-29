'use client';

import { useMemo, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useQueryClient } from '@tanstack/react-query';
import { createAuthenticatedFetch } from '@language-drill/api-client';
import { useActiveLanguage } from '../../../components/shell/active-language-provider';
import { useIsMobile } from '../../../lib/responsive';
import { useTheoryTopics } from '../../../lib/hooks/use-theory-topics';
import {
  groupTopics,
  type GroupBy,
  type SortBy,
} from '../../../lib/theory-library/group-sort';
import { TheoryLibraryHeader } from './_components/theory-library-header';
import { TheorySearchBox } from './_components/theory-search-box';
import { TheoryControls } from './_components/theory-controls';
import { TheoryGroup } from './_components/theory-group';
import {
  TheoryListLoading,
  TheoryListError,
  TheoryEmptyLanguage,
  TheoryNoResults,
} from './_components/theory-list-states';

// The two largest groups open by default on the mobile accordion (matches the
// prototype); everything else starts collapsed.
function defaultOpenGroupIds(groups: { id: string; topics: unknown[] }[]): Set<string> {
  return new Set(
    [...groups]
      .sort((a, b) => b.topics.length - a.topics.length)
      .slice(0, 2)
      .map((g) => g.id),
  );
}

export default function TheoryLibraryPage() {
  const { activeLanguage } = useActiveLanguage();
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);
  const isMobile = useIsMobile();

  const [search, setSearch] = useState('');
  const [groupBy, setGroupBy] = useState<GroupBy>('category');
  const [sortBy, setSortBy] = useState<SortBy>('curriculum');

  const { topics, isLoading, isError } = useTheoryTopics({
    language: activeLanguage,
    fetchFn,
  });

  const groups = groupTopics(topics, groupBy, sortBy, search);
  const openByDefault = defaultOpenGroupIds(groups);

  // Loading / error only "own" the page when there are no topics to show yet
  // (static editorial topics may render while the DB query is in flight).
  const showLoading = isLoading && topics.length === 0;
  const showError = isError && topics.length === 0;
  const searching = search.trim() !== '';

  function renderBody() {
    if (showLoading) return <TheoryListLoading />;
    if (showError) {
      return (
        <TheoryListError
          onRetry={() => {
            void queryClient.invalidateQueries({
              queryKey: ['theory', 'list', activeLanguage],
            });
          }}
        />
      );
    }
    if (topics.length === 0) {
      return <TheoryEmptyLanguage language={activeLanguage} />;
    }
    if (groups.length === 0) {
      return <TheoryNoResults query={search.trim()} onClear={() => setSearch('')} />;
    }
    return (
      <div className="theory-groups">
        {groups.map((group) => (
          <TheoryGroup
            key={group.id}
            group={group}
            query={search}
            isMobile={isMobile}
            defaultOpen={searching || openByDefault.has(group.id)}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-s-5">
      <TheoryLibraryHeader topicCount={topics.length} />
      <TheorySearchBox value={search} onChange={setSearch} />
      <TheoryControls
        groupBy={groupBy}
        sortBy={sortBy}
        onGroupByChange={setGroupBy}
        onSortByChange={setSortBy}
      />
      {renderBody()}
    </div>
  );
}
