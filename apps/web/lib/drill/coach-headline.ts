export interface SessionError {
  grammarPointKey: string | null;
  errorType: string;
  severity: string;
  text: string;
  correction: string;
}
