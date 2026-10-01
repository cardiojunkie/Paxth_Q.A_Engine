export interface AttributeSet {
  id: string;
  name: string;
  rulesMarkdown: string;
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
