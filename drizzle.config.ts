import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './libs/**/*.schema.ts',
  out: './libs/shared/database/src/lib/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env['DATABASE_URL']!,
  },
});
