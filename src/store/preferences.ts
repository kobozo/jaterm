export type Preferences = {
  fontSize: number;
  theme: 'light' | 'dark';
}

export const defaultPreferences: Preferences = {
  fontSize: 13,
  theme: 'dark',
};

