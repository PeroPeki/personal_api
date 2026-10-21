export const MAX_ARCHIVE_BYTES = 5 * 1024 * 1024;
export interface Profile {
  displayName: string;
  timezone: string;
  age?: number;
  heightCm?: number;
  sex?: "male" | "female";
  massGoal?: "maintain" | "lose" | "gain";
  activityLevel: number;
  aiConsent: boolean;
  readingInterests: string[];
  goals: {
    learningMinutes: number;
    socialMinutes: number;
    steps: number;
    sleepMinHours: number;
    sleepMaxHours: number;
    bedtime: string;
    wakeTime: string;
  };
}
export type ProfilePatch = Partial<
  Omit<Profile, "age" | "heightCm" | "sex" | "massGoal">
> & {
  age?: number | null;
  heightCm?: number | null;
  sex?: Profile["sex"] | null;
  massGoal?: Profile["massGoal"] | null;
};
export interface AuthResponse {
  user: { id: string; email: string };
  profile: Profile;
  dataGeneration: number;
}
export type LogKind =
  | "weight"
  | "workout"
  | "sleep"
  | "nutrition"
  | "social"
  | "steps"
  | "energy"
  | "measurement";
export interface LogRecord {
  id: string;
  kind: LogKind;
  date: string;
  occurredAt: string;
  source: "manual" | "apple-health";
  healthKey?: string;
  data: Record<string, number | string>;
  createdAt?: string;
  updatedAt?: string;
}
export interface FocusInterval {
  start: string;
  end: string | null;
}
export interface FocusSession {
  id: string;
  category: string;
  status: "running" | "paused" | "finished";
  intervals: FocusInterval[];
  version: number;
  createdAt: string;
  updatedAt: string;
  durationMinutes: number;
  correctedMinutes: number | null;
}
export interface DailyAggregate {
  date: string;
  learningMinutes: number;
  steps: number | null;
  activeCalories: number | null;
  weightKg: number | null;
  sleepHours: number | null;
  socialMinutes: number | null;
  nutrition: {
    calories: number | null;
    proteinGrams: number | null;
    carbsGrams: number | null;
    fatGrams: number | null;
  } | null;
  workoutMinutes: number | null;
  workoutCount: number | null;
}
export interface Insight {
  id: string;
  title: string;
  text: string;
  kind: "rule" | "ai";
  createdAt?: string;
}
export interface BodyEstimates {
  calories: {
    resting: number;
    maintenance: number;
    label: string;
  } | null;
  proteinGrams: {
    min: number;
    max: number;
  } | null;
  bodyFat: {
    percent: number;
    label: string;
  } | null;
}
export interface Dashboard {
  profile: Profile;
  today: DailyAggregate;
  history: DailyAggregate[];
  recentLogs: LogRecord[];
  activeFocus: FocusSession | null;
  lastHealthSync: string | null;
  insights: Insight[];
  estimates: BodyEstimates;
}
export interface Article {
  id: string;
  title: string;
  url: string;
  source: string;
  summary: string;
  minutes: number;
  read: boolean;
  selected: boolean;
}
export interface ReadingResponse {
  articles: Article[];
  date: string;
}
export interface InsightsResponse {
  rules: Insight[];
  ai: Insight | null;
  configured: boolean;
  provider: string | null;
}
export interface IntegrationStatus {
  active: boolean;
  createdAt: string | null;
  lastHealthSync: string | null;
}
export interface ExportData {
  version: 1;
  exportedAt: string;
  profile: Profile;
  logs: LogRecord[];
  focus: FocusSession[];
  readingState: {
    articleId: string;
    read: boolean;
  }[];
}
export type FocusAction =
  | {
      action: "start";
      id: string;
      category: string;
    }
  | {
      action: "pause" | "resume" | "finish";
      id: string;
      version: number;
    }
  | {
      action: "correct";
      id: string;
      version: number;
      durationMinutes: number;
    };
