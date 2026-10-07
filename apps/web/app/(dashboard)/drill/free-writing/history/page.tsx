'use client';

import { useMemo } from 'react';
import { useAuth } from '@clerk/nextjs';
import { createAuthenticatedFetch } from '@language-drill/api-client';
import { useActiveLanguage } from '../../../../../components/shell';
import { FwHistoryList } from '../_components/fw-history-list';
import '../free-writing.css';

export default function FreeWritingHistoryPage() {
  const { getToken } = useAuth();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);
  const { activeLanguage } = useActiveLanguage();

  return <FwHistoryList language={activeLanguage} fetchFn={fetchFn} />;
}
