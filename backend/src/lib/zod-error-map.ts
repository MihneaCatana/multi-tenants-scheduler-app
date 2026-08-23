/**
 * Custom Zod error map for mapping Zod's internal issue codes to stable
 * machine-readable codes that the frontend can localize.
 *
 * Use via `z.safeParse(input)` or in the error handler when formatting
 * ZodError details.
 */
import { type ZodIssue, z } from 'zod';

/**
 * Map a Zod issue to a stable error code.
 * Falls back to the Zod issue code itself (e.g. "too_small", "invalid_enum_value")
 * if no specific mapping exists.
 */
export function zodIssueToCode(issue: ZodIssue): string {
  const code = issue.code;

  if (code === 'too_small') {
    if (issue.type === 'string') return 'TOO_SHORT';
    if (issue.type === 'number' || issue.type === 'bigint') return 'TOO_SMALL';
    if (issue.type === 'array') return 'TOO_FEW_ITEMS';
    return 'TOO_SMALL';
  }

  if (code === 'too_big') {
    if (issue.type === 'string') return 'TOO_LONG';
    if (issue.type === 'number' || issue.type === 'bigint') return 'TOO_LARGE';
    if (issue.type === 'array') return 'TOO_MANY_ITEMS';
    return 'TOO_LARGE';
  }

  if (code === 'invalid_string') {
    const validation = (issue as { validation?: string }).validation;
    if (validation === 'email') return 'INVALID_EMAIL';
    if (validation === 'uuid') return 'INVALID_UUID';
    if (validation === 'url') return 'INVALID_URL';
    if (validation === 'regex') return 'INVALID_FORMAT';
    return 'INVALID_STRING';
  }

  if (code === 'invalid_enum_value') return 'INVALID_OPTION';
  if (code === 'invalid_type') return 'INVALID_TYPE';
  if (code === 'invalid_union') return 'INVALID_VALUE';
  if (code === 'unrecognized_keys') return 'UNRECOGNIZED_FIELDS';

  return code;
}

/**
 * Custom error map that attaches a stable `errorCode` to each Zod issue.
 * Used by the error handler to produce frontend-friendly detail objects.
 */
export function zodErrorMap(
  issue: ZodIssue,
  _ctx: z.ErrorMapCtx,
): { message: string; errorCode?: string } {
  const code = zodIssueToCode(issue);

  // Build a human-friendly fallback message from the issue.
  const path = issue.path.join('.') || 'field';
  const message = issue.message || `${path}: validation failed`;

  return { message, errorCode: code };
}

/**
 * Format a ZodError into the `details` array shape the error handler sends.
 * Each entry has `{ path, message, code }` for stable frontend mapping.
 */
export function formatZodDetails(error: z.ZodError): Array<{
  path: string;
  message: string;
  code: string;
}> {
  return error.issues.map((issue) => ({
    path: issue.path.join('.') || '(root)',
    message: issue.message,
    code: zodIssueToCode(issue),
  }));
}
