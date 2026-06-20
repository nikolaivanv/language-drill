export const LEGAL = {
  controller: 'Ivan Nikola',
  basedIn: 'Hungary',
  contactEmail: 'info@langdrill.app',
  lastUpdated: '2026-06-20',
  governingLaw: 'Hungary',
  minAge: 16,
  subProcessors: [
    { name: 'Clerk', purpose: 'Authentication and account management' },
    { name: 'Amazon Web Services (AWS)', purpose: 'Compute, storage, speech synthesis and transcription' },
    { name: 'Anthropic', purpose: 'AI evaluation of your written answers' },
    { name: 'Neon', purpose: 'Database hosting' },
    { name: 'Upstash', purpose: 'Rate limiting' },
    { name: 'Vercel', purpose: 'Web application hosting' },
    { name: 'Sentry', purpose: 'Error monitoring (no cookies; user ID only)' },
    { name: 'Langfuse', purpose: 'LLM-call observability (records your user ID and the text of your answers)' },
    { name: 'Cloudflare', purpose: 'DNS and email forwarding for our contact address' },
  ],
} as const;
