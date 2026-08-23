/**
 * Global DB schema barrel — imported by drizzle.config.global.ts and by the
 * application to build the typed Drizzle instance for the global DB.
 */
export * from './tenants.js';
export * from './users.js';
export * from './sessions.js';
export * from './features.js';

export { tenants } from './tenants.js';
export { users } from './users.js';
export { sessions } from './sessions.js';
export { features, tenantFeatures } from './features.js';
