/**
 * OMP version compatibility check.
 *
 * Unknown versions are treated as non-blocking warnings. The host still tries
 * to run because OMP may be ahead of this adapter.
 */

export const MIN_OMP_VERSION = '0.0.0';
export const MIN_PROTOCOL_VERSION = 1;

export interface OmpVersionCheckResult {
  compatible: boolean;
  warning?: string;
}

function parseSemver(value: string | undefined): [number, number, number] | undefined {
  if (!value) return undefined;
  const match = value.trim().match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!match) return undefined;
  return [
    parseInt(match[1]!, 10),
    match[2] ? parseInt(match[2], 10) : 0,
    match[3] ? parseInt(match[3], 10) : 0,
  ];
}

function compareSemver(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) {
    const av = a[i]!;
    const bv = b[i]!;
    if (av !== bv) return av - bv;
  }
  return 0;
}

export function checkOmpVersionCompatibility(
  ompVersion?: string,
  protocolVersion?: string,
): OmpVersionCheckResult {
  const missing: string[] = [];
  if (!ompVersion) missing.push('OMP version');

  let protocolNum: number | undefined;
  if (protocolVersion !== undefined) {
    const parsed = parseInt(protocolVersion, 10);
    protocolNum = Number.isFinite(parsed) ? parsed : undefined;
  }
  if (protocolNum === undefined) missing.push('protocol version');

  if (missing.length > 0) {
    return {
      compatible: true,
      warning: `Could not determine ${missing.join(' and ')}. Some features may not work correctly.`,
    };
  }

  const ompParsed = parseSemver(ompVersion!);
  if (!ompParsed) {
    return {
      compatible: true,
      warning: `OMP version "${ompVersion}" is not a recognized semver. Compatibility could not be verified.`,
    };
  }

  const minParsed = parseSemver(MIN_OMP_VERSION)!;
  if (compareSemver(ompParsed, minParsed) < 0) {
    return {
      compatible: false,
      warning: `OMP version ${ompVersion} is older than the minimum supported version ${MIN_OMP_VERSION}. Please upgrade OMP.`,
    };
  }

  if (protocolNum! < MIN_PROTOCOL_VERSION) {
    return {
      compatible: false,
      warning: `OMP protocol version ${protocolNum} is older than the minimum supported version ${MIN_PROTOCOL_VERSION}. Please upgrade OMP.`,
    };
  }

  return { compatible: true };
}
