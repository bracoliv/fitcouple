export interface FitGameConfig {
  googleClientId: string;
  googleApiKey: string;
  googleAppId: string;
  workerUrl: string;
}

export interface AccountView {
  email: string;
  name: string;
  plan: "free" | "premium" | "gift";
  giftExpires: string | null;
  daysLeft: number | null;
  endingSoon: boolean;
  giftsEnabled: boolean;
}

export interface AiQuota {
  premium: boolean;
  features: { feature: string; used: number; cap: number | null; left: number | null }[];
}
