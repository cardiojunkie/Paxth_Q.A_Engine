export type JobType = 'qa' | 'catalog';

export interface CatalogState {
  status: 'completed' | 'failed';
  revision: number;
  jobId: string;
  headers: string[];
  row?: Record<string, string>;
  warnings: string[];
  error?: string | null;
  tokensUsed?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  timeTaken?: number;
}

export interface AttributeSet {
  id: string;
  name: string;
  rulesMarkdown: string;
  catalogHeaders: string[];
  createdAt: number;
  updatedAt: number;
}

export interface User {
  id: string;
  username: string;
  role: 'admin' | 'user';
  loginTime: string;
}

export interface UserAccount {
  id: string;
  username: string;
  role: 'admin' | 'user';
  createdAt: string;
  lastLogin?: string;
}

export interface UserAccountInput {
  username: string;
  password: string;
  role: 'admin' | 'user';
}

export interface CatalogFileGroup {
  attributeSet: string;
  headers: string[];
  rows: Record<string, string>[];
}

export interface CatalogOutputs {
  groups: CatalogFileGroup[];
  shipping: { region: string; headers: string[]; rows: Record<string, string>[] } | null;
  shippingError?: string;
}
