import fs from 'node:fs';
import path from 'node:path';

/**
 * Keeps the default suite honest about what it proves.
 *
 * The promoted route tests use synthetic upstream replies and exact response assertions.
 * Any future live probes must stay outside the default suite and its network guard.
 */

const ROOT = path.join(__dirname, '..');
const LEGACY_DIR = path.join(ROOT, 'tests', 'legacy-routes');
const ROOT_DIR_TOKEN = '<rootDir>';
const LEGACY_PATTERN = `${ROOT_DIR_TOKEN}/tests/legacy-routes/`;
const OFFLINE_SETUP = `${ROOT_DIR_TOKEN}/tests/helpers/offlineNetwork.cjs`;

const PROMOTED_ROUTE_TESTS = [
  'batchGetSongInfo.test.ts',
  'batchGetSongLists.test.ts',
  'getComments.test.ts',
  'getDigitalAlbumLists.test.ts',
  'getDownloadQQMusic.test.ts',
  'getHotkey.test.ts',
  'getImageUrl.test.ts',
  'getLyric.test.ts',
  'getMv.test.ts',
  'getMvByTag.test.ts',
  'getMvPlay.test.ts',
  'getNewDisks.test.ts',
  'getRadioLists.test.ts',
  'getRanks.test.ts',
  'getSimilarSinger.test.ts',
  'getSingerList.test.ts',
  'getSingerMv.test.ts',
  'getSingerStarNum.test.ts',
  'getSmartbox.test.ts',
  'getSongListCategories.test.ts',
  'getSongLists.test.ts',
  'getTicketInfo.test.ts',
  'getTopLists.test.ts',
];

/** Folia calls these routes, so their tests stay in the default suite as upstream-stubbed contracts. */
const FOLIA_ROUTE_TESTS = [
  'getSingerAlbum.test.ts',
  'getSingerHotsong.test.ts',
  'getSongInfo.test.ts',
];

const STATUS_SET_ONLY = /expect\(\s*\[[\d\s,]+\]\s*\)\.toContain\(\s*\w+\.status\s*\)/;

const listTests = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listTests(full);
    return /\.test\.[cm]?[jt]s$/.test(entry.name) ? [full] : [];
  });

interface JestConfig {
  testMatch?: string[];
  testPathIgnorePatterns?: string[];
  setupFiles?: string[];
  setupFilesAfterEnv?: string[];
  coverageThreshold?: unknown;
  collectCoverage?: boolean;
}

const loadConfig = (file: string): JestConfig => {
  const full = path.join(ROOT, file);
  delete require.cache[require.resolve(full)];
  return require(full) as JestConfig;
};

const packageScripts = (): Record<string, string> =>
  JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts;

describe('default test suite layout', () => {
  const defaultConfig = loadConfig('jest.config.js');

  const defaultSuiteFiles = () =>
    listTests(path.join(ROOT, 'tests')).filter(
      (file) => !file.startsWith(`${LEGACY_DIR}${path.sep}`),
    );

  it('runs the expanded Folia contracts offline in both commands', () => {
    const contracts = packageScripts()['test:contracts'];
    expect(contracts).toContain('--setupFilesAfterEnv ./tests/helpers/offlineNetwork.cjs');
    for (const file of [
      'tests/playlist.track-writes.routes.test.ts',
      'tests/subscriptions.routes.test.ts',
      'tests/recommend.routes.test.ts',
      'tests/daily-songs.routes.test.ts',
      'tests/operations.music-play-controlled-hints.test.ts',
      'tests/services.qr-login.test.ts',
      'tests/operations.qr-check.test.ts',
      'tests/errors.runtime-baseline.test.ts',
      'tests/song.like.routes.test.ts',
      'tests/album.subscribe.routes.test.ts',
      'tests/search.routes.test.ts',
      'tests/folia.login-contracts.test.ts',
    ]) {
      expect(contracts.split(' ')).toContain(file);
      expect(defaultSuiteFiles()).toContain(path.join(ROOT, file));
    }
  });

  it('has no status-set-only route test left in the default suite', () => {
    const offenders = defaultSuiteFiles()
      .filter((file) => STATUS_SET_ONLY.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(ROOT, file));

    expect(offenders).toEqual([]);
  });

  it('keeps the Folia route tests in the default suite', () => {
    for (const name of FOLIA_ROUTE_TESTS)
      expect(fs.existsSync(path.join(ROOT, 'tests', name))).toBe(true);
  });

  it('promotes every mocked legacy route contract into the default suite', () => {
    const kept = fs.existsSync(LEGACY_DIR) ? listTests(LEGACY_DIR) : [];

    expect(kept).toEqual([]);
    for (const name of PROMOTED_ROUTE_TESTS)
      expect(fs.existsSync(path.join(ROOT, 'tests', name))).toBe(true);
  });

  it('leaves the legacy directory out of the default run without weakening it', () => {
    expect(defaultConfig.testPathIgnorePatterns).toContain(LEGACY_PATTERN);
    expect(defaultConfig.setupFilesAfterEnv).toContain(OFFLINE_SETUP);
    expect(defaultConfig.coverageThreshold).toEqual({
      global: { branches: 50, functions: 50, lines: 75, statements: 75 },
    });
    expect(packageScripts().test).toBe('jest');
  });
});

describe('legacy route commands', () => {
  it('keeps the reserved legacy command offline and allows an empty directory', () => {
    const config = loadConfig('jest.legacy-routes.config.js');

    expect(config.testMatch).toEqual([`${LEGACY_PATTERN}**/*.test.ts`]);
    expect(config.testPathIgnorePatterns ?? []).not.toContain(LEGACY_PATTERN);
    expect(config.setupFilesAfterEnv).toContain(OFFLINE_SETUP);
    expect(packageScripts()['test:legacy-routes']).toBe(
      'jest --config jest.legacy-routes.config.js --passWithNoTests',
    );
  });

  it('reserves unguarded probes for their own explicit command', () => {
    const config = loadConfig('jest.legacy-routes.live.config.js');

    expect(config.testMatch).toEqual([`${LEGACY_PATTERN}**/*.test.ts`]);
    expect(config.setupFilesAfterEnv ?? []).not.toContain(OFFLINE_SETUP);
    expect(packageScripts()['probe:legacy-routes']).toBe(
      'jest --config jest.legacy-routes.live.config.js --runInBand --passWithNoTests',
    );
  });
});
