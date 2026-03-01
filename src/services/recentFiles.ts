/**
 * Recent Files Service
 * Tracks recently opened files in localStorage
 */

const STORAGE_KEY = 'blink-recent-files';
const MAX_RECENT_FILES = 15;

export interface RecentFile {
  path: string;
  name: string;
  timestamp: number;
}

export const getRecentFiles = (): RecentFile[] => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error('Failed to load recent files:', e);
  }
  return [];
};

export const addRecentFile = (path: string, name: string): void => {
  try {
    const recent = getRecentFiles();

    // Remove if already exists
    const filtered = recent.filter((f) => f.path !== path);

    // Add to front
    filtered.unshift({
      path,
      name,
      timestamp: Date.now(),
    });

    // Limit to max
    const limited = filtered.slice(0, MAX_RECENT_FILES);

    localStorage.setItem(STORAGE_KEY, JSON.stringify(limited));
  } catch (e) {
    console.error('Failed to save recent file:', e);
  }
};

export const removeRecentFile = (path: string): void => {
  try {
    const recent = getRecentFiles();
    const filtered = recent.filter((f) => f.path !== path);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
  } catch (e) {
    console.error('Failed to remove recent file:', e);
  }
};

export const clearRecentFiles = (): void => {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.error('Failed to clear recent files:', e);
  }
};
