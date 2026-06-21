export interface WeeklySummaryJobMessage {
  userId: string;
  email: string;
  periodKey: string;
  windowStartIso: string;
  windowEndIso: string;
}
