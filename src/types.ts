export interface AttributeSet {
  id: string;
  name: string;
  rulesMarkdown: string;
  createdAt: number;
  updatedAt: number;
}

export interface User {
  username: string;
  role: 'admin' | 'user';
  loginTime: string;
}

export interface UserAccount {
  id: string;
  username: string;
  password?: string;
  role: 'admin' | 'user';
  createdAt: string;
  lastLogin?: string;
}

export interface SiteSelectorRule {
  id: string;
  website: string;
  selectors: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

