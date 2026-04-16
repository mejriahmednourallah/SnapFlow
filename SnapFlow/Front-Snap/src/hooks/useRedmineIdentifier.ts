import { useMemo } from 'react';
import { extractRedmineIdentifier } from '@/services/redmineService';

/**
 * Extracts the Redmine project identifier slug from a URL.
 * Returns null if the URL doesn't match. Memoized for stability.
 *
 * Example: "https://redmine.example.com/projects/my-project" → "my-project"
 */
export function useRedmineIdentifier(url: string | null | undefined): string | null {
  return useMemo(() => {
    if (!url) return null;
    return extractRedmineIdentifier(url);
  }, [url]);
}
