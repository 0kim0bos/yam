import fsp from 'node:fs/promises';
import path from 'node:path';

export type MemoryReadState = 'missing' | 'empty' | 'complete' | 'unreadable' | 'invalid' | 'incomplete';
export interface MemoryRecord {
  schemaVersion: number;
  id: string;
  kind: string;
  status: string;
  summary: string;
  evidence?: string;
  action?: string;
  source?: string;
  createdAt?: string;
  [key: string]: unknown;
}
export interface MemoryReadReport {
  schema: 'yam.memory-read.v1';
  state: MemoryReadState;
  complete: boolean;
  records: MemoryRecord[];
  diagnostics: Array<{ operation: string; code: string; record_index?: number }>;
  diagnostics_truncated: boolean;
}
export type MemoryReadIo = Pick<typeof fsp, 'access' | 'readdir' | 'readFile'>;
const kinds = new Set(['wrong_decision', 'repeat_mistake', 'direction_change', 'lesson', 'risk', 'command']);
const safeCodes = new Set(['ENOENT', 'EACCES', 'EPERM', 'EIO', 'ENOTDIR', 'EISDIR', 'EMFILE', 'ENFILE', 'ELOOP']);

function errorCode(error: unknown): string {
  const code = (error as { code?: unknown })?.code;
  return typeof code === 'string' && safeCodes.has(code) ? code : 'READ_FAILED';
}

function isMemoryRecord(value: unknown): value is MemoryRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  return r.schemaVersion === 1 && typeof r.id === 'string' && r.id.length > 0
    && typeof r.kind === 'string' && kinds.has(r.kind)
    && (r.status === 'active' || r.status === 'resolved')
    && typeof r.summary === 'string' && r.summary.trim().length > 0
    && ['evidence', 'action', 'source', 'createdAt', 'resolvedAt', 'resolution'].every((key) => r[key] === undefined || typeof r[key] === 'string');
}

/** Diagnostics intentionally contain no filesystem paths, record text, or exception messages. */
export async function readMemoryDirectory(recordsDir: string, io: MemoryReadIo = fsp): Promise<MemoryReadReport> {
  const report: MemoryReadReport = {
    schema: 'yam.memory-read.v1', state: 'complete', complete: true,
    records: [], diagnostics: [], diagnostics_truncated: false
  };
  const diagnose = (operation: string, code: string, record_index?: number) => {
    if (report.diagnostics.length < 20) report.diagnostics.push({ operation, code, ...(record_index === undefined ? {} : { record_index }) });
    else report.diagnostics_truncated = true;
  };
  try {
    await io.access(recordsDir);
  } catch (error) {
    const code = errorCode(error);
    report.state = code === 'ENOENT' ? 'missing' : 'unreadable';
    report.complete = false;
    diagnose('access', code);
    return report;
  }
  let entries;
  try {
    entries = await io.readdir(recordsDir, { withFileTypes: true });
  } catch (error) {
    // An existing directory disappearing mid-read is incomplete, not an empty memory.
    report.state = errorCode(error) === 'ENOENT' ? 'incomplete' : 'unreadable';
    report.complete = false;
    diagnose('readdir', errorCode(error));
    return report;
  }
  let invalid = 0;
  let unreadable = 0;
  const candidates = entries.filter((entry) => entry.name.endsWith('.json')).sort((a, b) => a.name.localeCompare(b.name));
  for (const [index, entry] of candidates.entries()) {
    if (!entry.isFile()) {
      unreadable += 1;
      diagnose('record_type', 'NOT_REGULAR_FILE', index);
      continue;
    }
    let text: string;
    try {
      text = await io.readFile(path.join(recordsDir, entry.name), 'utf8');
    } catch (error) {
      unreadable += 1;
      diagnose('read', errorCode(error), index);
      continue;
    }
    let record: unknown;
    try { record = JSON.parse(text); } catch {
      invalid += 1;
      diagnose('parse', 'INVALID_JSON', index);
      continue;
    }
    if (!isMemoryRecord(record)) {
      invalid += 1;
      diagnose('validate', 'INVALID_RECORD', index);
      continue;
    }
    report.records.push(record);
  }
  report.records.sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
  report.complete = invalid + unreadable === 0;
  report.state = report.complete ? (report.records.length ? 'complete' : 'empty')
    : report.records.length || (invalid && unreadable) ? 'incomplete'
      : unreadable ? 'unreadable' : 'invalid';
  return report;
}
