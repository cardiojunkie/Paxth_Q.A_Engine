export interface AttributeSet {
  id: string;
  name: string;
  rulesMarkdown: string;
  createdAt: number;
  updatedAt: number;
}

export interface User {
  username: string;
}

export interface SiteSelectorRule {
  id: string;
  website: string;
  selectors: string;
  tabSelector?: string;
  tabContentSelector?: string;
  tabWaitMs?: number;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}
