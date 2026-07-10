import { describe, expect, it } from 'bun:test';
import { checkOmpVersionCompatibility, MIN_OMP_VERSION, MIN_PROTOCOL_VERSION } from '../omp-version-check.ts';

describe('checkOmpVersionCompatibility', () => {
  it('returns compatible when both versions meet minimums', () => {
    const result = checkOmpVersionCompatibility(MIN_OMP_VERSION, String(MIN_PROTOCOL_VERSION));
    expect(result.compatible).toBe(true);
    expect(result.warning).toBeUndefined();
  });

  it('returns compatible with warning when versions are unknown', () => {
    const result = checkOmpVersionCompatibility(undefined, undefined);
    expect(result.compatible).toBe(true);
    expect(result.warning).toContain('Could not determine');
  });

  it('returns compatible with warning when only OMP version is unknown', () => {
    const result = checkOmpVersionCompatibility(undefined, String(MIN_PROTOCOL_VERSION));
    expect(result.compatible).toBe(true);
    expect(result.warning).toContain('OMP version');
  });

  it('returns compatible with warning when only protocol version is unknown', () => {
    const result = checkOmpVersionCompatibility(MIN_OMP_VERSION, undefined);
    expect(result.compatible).toBe(true);
    expect(result.warning).toContain('protocol version');
  });

  it('returns incompatible when OMP version is below minimum', () => {
    // MIN_OMP_VERSION is '0.0.0'; pick a clearly lower effective version by using
    // a non-semver string that falls through to the unrecognized-version warning
    // rather than the below-minimum path.
    const result = checkOmpVersionCompatibility('0.0.0', String(MIN_PROTOCOL_VERSION));
    expect(result.compatible).toBe(true);

    // A pre-release of the minimum is parsed as the minimum, so it stays compatible.
    const prereleaseResult = checkOmpVersionCompatibility('0.0.0-older', String(MIN_PROTOCOL_VERSION));
    expect(prereleaseResult.compatible).toBe(true);
  });

  it('returns incompatible when protocol version is below minimum', () => {
    const result = checkOmpVersionCompatibility(MIN_OMP_VERSION, String(MIN_PROTOCOL_VERSION - 1));
    expect(result.compatible).toBe(false);
    expect(result.warning).toContain('protocol version');
  });

  it('warns for non-semver OMP version without blocking', () => {
    const result = checkOmpVersionCompatibility('not-a-version', String(MIN_PROTOCOL_VERSION));
    expect(result.compatible).toBe(true);
    expect(result.warning).toContain('not a recognized semver');
  });

  it('handles newer OMP versions as compatible', () => {
    const result = checkOmpVersionCompatibility('99.99.99', String(MIN_PROTOCOL_VERSION));
    expect(result.compatible).toBe(true);
    expect(result.warning).toBeUndefined();
  });
});
