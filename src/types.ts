export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  SITE_TITLE: string;
  SITE_DESCRIPTION: string;
  ADMIN_PASSWORD: string;
  SESSION_SECRET: string;
}

export interface Post {
  id: number;
  slug: string;
  title: string;
  description: string;
  content: string;
  category: string | null;
  tags: string;
  author: string;
  hero_image: string | null;
  draft: number;
  pub_date: number;
  updated_date: number;
}

export interface PostInput {
  slug: string;
  title: string;
  description: string;
  content: string;
  category: string | null;
  tags: string;
  author: string;
  hero_image: string | null;
  draft: number;
  pub_date: number;
}
