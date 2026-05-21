import { describe, expect, it } from 'bun:test';
import { shouldIncludeCoverageFile } from './coverage-files.ts';

describe('coverage file filtering', () => {
  it('includes production source files and excludes test and runtime entry files', () => {
    expect(shouldIncludeCoverageFile('src/App.tsx')).toBe(true);
    expect(
      shouldIncludeCoverageFile(
        'webos/service/com.biliwebos.app.service/src/service.ts',
      ),
    ).toBe(true);

    expect(shouldIncludeCoverageFile('src/main.tsx')).toBe(false);
    expect(shouldIncludeCoverageFile('src/player/PlayerPage.test.ts')).toBe(
      false,
    );
    expect(
      shouldIncludeCoverageFile(
        'webos/service/com.biliwebos.app.service/test/service-runtime.test.ts',
      ),
    ).toBe(false);
    expect(shouldIncludeCoverageFile('node_modules/pkg/index.ts')).toBe(false);
  });
});
