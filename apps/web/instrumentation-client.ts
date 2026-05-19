import * as Sentry from '@sentry/nextjs';

import { getSharedSentryOptions } from './lib/sentry/shared-options';

Sentry.init(getSharedSentryOptions());

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
