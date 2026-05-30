export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  IMAGES: R2Bucket;
  SITE_TITLE: string;
  SITE_DESCRIPTION: string;
  CANONICAL_URL?: string;  // URL canônica (após mover para domínio final)
  ADMIN_USERNAME: string;
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
  source_url: string | null;
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
  source_url?: string | null;
}

// ============== CARTÕES DE CRÉDITO ==============
export interface CreditCard {
  id: number;
  slug: string;
  name: string;
  issuer: string;
  image_url: string | null;
  tagline: string;
  annual_fee: string;
  benefits: string;        // JSON array de strings
  badges: string;          // JSON array de strings
  rating: number | null;   // 0–5
  affiliate_url: string;
  cta_label: string;
  category: string;
  featured: number;
  sort_order: number;
  active: number;
  created_at: number;
  updated_at: number;
}

export interface CreditCardInput {
  slug: string;
  name: string;
  issuer: string;
  image_url: string | null;
  tagline: string;
  annual_fee: string;
  benefits: string;
  badges: string;
  rating: number | null;
  affiliate_url: string;
  cta_label: string;
  category: string;
  featured: number;
  sort_order: number;
  active: number;
}

// ============== EMPREGOS ==============
export interface Job {
  id: number;
  slug: string;
  title: string;
  company: string;
  company_logo: string | null;
  location: string;
  remote: number;
  salary: string;
  type: string;
  category: string;
  description: string;
  apply_url: string;
  featured: number;
  active: number;
  posted_at: number;
  expires_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface JobInput {
  slug: string;
  title: string;
  company: string;
  company_logo: string | null;
  location: string;
  remote: number;
  salary: string;
  type: string;
  category: string;
  description: string;
  apply_url: string;
  featured: number;
  active: number;
  posted_at: number;
  expires_at: number | null;
}

/** Tipo de clique de saída rastreado. */
export type OutboundClickKind = 'card' | 'job' | 'promo';
