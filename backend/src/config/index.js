const { z } = require('zod');

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  GEMINI_API_KEY: z.string().default(''),
  LLM_MODEL: z.string().trim().default(''),
  DB_POOL_SIZE: z.coerce.number().int().min(1).max(100).default(10)
}).superRefine((config, context) => {
  if (config.GEMINI_API_KEY && !config.LLM_MODEL) {
    context.addIssue({
      code: 'custom',
      path: ['LLM_MODEL'],
      message: 'LLM_MODEL is required when GEMINI_API_KEY is set.'
    });
  }
});

function loadConfig(environment = process.env) {
  const parsed = environmentSchema.safeParse(environment);
  if (!parsed.success) {
    const invalidKeys = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))];
    throw new Error(`Invalid application environment. Check: ${invalidKeys.join(', ')}`);
  }
  return parsed.data;
}

module.exports = { loadConfig };
