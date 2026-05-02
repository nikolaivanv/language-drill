import type { ReactNode } from 'react';

export type TheorySection = {
  id: string;
  title: string;
  body: ReactNode;
};

export type TheoryTopic = {
  id: string;
  title: string;
  subtitle: string;
  cefr: string;
  sections: TheorySection[];
};
