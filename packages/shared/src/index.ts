export enum Language {
  EN = "EN",
  ES = "ES",
  DE = "DE",
  TR = "TR",
}

export enum CefrLevel {
  A1 = "A1",
  A2 = "A2",
  B1 = "B1",
  B2 = "B2",
  C1 = "C1",
  C2 = "C2",
}

export type ApiError = {
  error: string;
  code: string;
  status: number;
};

export type InviteCode = {
  code: string;
  expiresAt?: string;
};
