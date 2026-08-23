import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * Cross-platform "am I the entry module?" check.
 *
 * `import.meta.url === \`file://\${process.argv[1]}\`` breaks on Windows because
 * the URL-encoded path never matches the raw argv string. We compare normalized
 * filesystem paths instead.
 */
export function isMainModule(metaUrl: string): boolean {
  if (!process.argv[1]) return false;
  try {
    const a = path.resolve(fileURLToPath(metaUrl));
    const b = path.resolve(process.argv[1]);
    return a.toLowerCase() === b.toLowerCase();
  } catch {
    return false;
  }
}
