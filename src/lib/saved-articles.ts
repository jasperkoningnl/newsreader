export const SAVED_ARTICLES_KEY = "saved_articles";

export type SavedArticle = {
  id: number;
  title: string;
  url: string;
  description: string | null;
  image_url: string | null;
  published_at: string | null;
  category: string | null;
  source: string;
  saved_at: string;
};

export function readSavedArticles(): SavedArticle[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SAVED_ARTICLES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as SavedArticle[];
  } catch {
    return [];
  }
}

export function writeSavedArticles(articles: SavedArticle[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SAVED_ARTICLES_KEY, JSON.stringify(articles));
}
