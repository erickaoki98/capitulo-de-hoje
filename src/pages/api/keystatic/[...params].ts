export const prerender = false;

import { makeHandler } from '@keystatic/astro/api';
import config from '../../../../keystatic.config';

const handler = makeHandler({ config });

export const GET = handler;
export const POST = handler;
