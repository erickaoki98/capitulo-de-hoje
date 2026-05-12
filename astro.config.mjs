// @ts-check

import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { defineConfig, fontProviders } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  site: 'https://example.com', // TODO: troque pela sua URL final
  output: 'static',
  adapter: cloudflare({
    imageService: 'cloudflare',
    platformProxy: { enabled: true },
  }),
  integrations: [mdx(), sitemap()],
  fonts: [
    {
      provider: fontProviders.local(),
      name: 'Atkinson',
      cssVariable: '--font-atkinson',
      fallbacks: ['sans-serif'],
      options: {
        variants: [
          {
            src: ['./src/assets/fonts/atkinson-regular.woff'],
            weight: 400,
            style: 'normal',
            display: 'swap',
          },
          {
            src: ['./src/assets/fonts/atkinson-bold.woff'],
            weight: 700,
            style: 'normal',
            display: 'swap',
          },
        ],
      },
    },
  ],
  markdown: {
    shikiConfig: {
      theme: 'github-dark',
      wrap: true,
    },
  },
});