/**
 * OMP locale behavior tests.
 *
 * Covers the Chinese-first default language, runtime language switching,
 * persistence through preferences.json, fallback for invalid persisted codes,
 * and the existence of critical OMP message keys in every supported locale.
 *
 * i18next and config paths are module-level singletons, so each scenario runs
 * in a fresh subprocess with its own CRAFT_CONFIG_DIR.
 */
import { describe, it, expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { pathToFileURL } from "url";

const I18N_INDEX_MODULE = pathToFileURL(
  join(import.meta.dir, "..", "index.ts"),
).href;
const PREFS_MODULE = pathToFileURL(
  join(import.meta.dir, "..", "..", "config", "preferences.ts"),
).href;
const SUBPROCESS_TEST_TIMEOUT = 15_000;

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function runScript(configDir: string, script: string): RunResult {
  const result = Bun.spawnSync([process.execPath, "--eval", script], {
    env: { ...process.env, CRAFT_CONFIG_DIR: configDir },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode ?? -1,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

function setupDir(): { configDir: string; prefsFile: string } {
  const configDir = mkdtempSync(join(tmpdir(), "omp-locale-"));
  return { configDir, prefsFile: join(configDir, "preferences.json") };
}

function writeRawPrefs(prefsFile: string, contents: Record<string, unknown>) {
  writeFileSync(prefsFile, JSON.stringify(contents, null, 2), "utf-8");
}

function subprocessIt(name: string, fn: () => void) {
  return it(name, fn, SUBPROCESS_TEST_TIMEOUT);
}

describe("OMP locale behavior", () => {
  subprocessIt("defaults to zh-Hans on first run", () => {
    const { configDir } = setupDir();
    try {
      const r = runScript(
        configDir,
        `
          import { setupI18n, i18n } from '${I18N_INDEX_MODULE}';
          setupI18n();
          console.log(JSON.stringify({
            resolvedLanguage: i18n.resolvedLanguage,
          }));
        `,
      );
      expect(r.exitCode).toBe(0);
      const result = JSON.parse(r.stdout);
      expect(result.resolvedLanguage).toBe("zh-Hans");
    } finally {
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  subprocessIt("switching to English updates the active language immediately", () => {
    const { configDir } = setupDir();
    try {
      const r = runScript(
        configDir,
        `
          import { setupI18n, i18n } from '${I18N_INDEX_MODULE}';
          setupI18n();
          const before = i18n.resolvedLanguage;
          await i18n.changeLanguage('en');
          const after = i18n.resolvedLanguage;
          console.log(JSON.stringify({ before, after }));
        `,
      );
      expect(r.exitCode).toBe(0);
      const result = JSON.parse(r.stdout);
      expect(result.before).toBe("zh-Hans");
      expect(result.after).toBe("en");
    } finally {
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  subprocessIt("persists the language choice in preferences.json", () => {
    const { configDir, prefsFile } = setupDir();
    try {
      const r = runScript(
        configDir,
        `
          import { setupI18n, i18n } from '${I18N_INDEX_MODULE}';
          import { setPersistedUiLanguage, getPersistedUiLanguage } from '${PREFS_MODULE}';
          setupI18n();
          await i18n.changeLanguage('en');
          setPersistedUiLanguage('en');
          console.log(JSON.stringify({
            persisted: getPersistedUiLanguage(),
          }));
        `,
      );
      expect(r.exitCode).toBe(0);
      expect(JSON.parse(r.stdout)).toEqual({ persisted: "en" });
      const raw = JSON.parse(readFileSync(prefsFile, "utf-8"));
      expect(raw.uiLanguage).toBe("en");
    } finally {
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  subprocessIt("restores the persisted language on the next startup", () => {
    const { configDir, prefsFile } = setupDir();
    try {
      writeRawPrefs(prefsFile, { uiLanguage: "en" });
      const r = runScript(
        configDir,
        `
          import { setupI18n, i18n } from '${I18N_INDEX_MODULE}';
          import { getPersistedUiLanguage } from '${PREFS_MODULE}';
          setupI18n();
          i18n.changeLanguage(getPersistedUiLanguage() ?? 'zh-Hans');
          console.log(JSON.stringify({
            resolvedLanguage: i18n.resolvedLanguage,
            persisted: getPersistedUiLanguage(),
          }));
        `,
      );
      expect(r.exitCode).toBe(0);
      const result = JSON.parse(r.stdout);
      expect(result.resolvedLanguage).toBe("en");
      expect(result.persisted).toBe("en");
    } finally {
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  subprocessIt("falls back to zh-Hans when the persisted code is unsupported", () => {
    const { configDir, prefsFile } = setupDir();
    try {
      writeRawPrefs(prefsFile, { uiLanguage: "xx" });
      const r = runScript(
        configDir,
        `
          import { setupI18n, i18n } from '${I18N_INDEX_MODULE}';
          import { getPersistedUiLanguage } from '${PREFS_MODULE}';
          setupI18n();
          const persisted = getPersistedUiLanguage();
          i18n.changeLanguage(persisted ?? 'zh-Hans');
          console.log(JSON.stringify({
            resolvedLanguage: i18n.resolvedLanguage,
            persisted: persisted ?? null,
          }));
        `,
      );
      expect(r.exitCode).toBe(0);
      const result = JSON.parse(r.stdout);
      expect(result.resolvedLanguage).toBe("zh-Hans");
      expect(result.persisted).toBeNull();
    } finally {
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it("critical OMP keys exist in every supported locale", () => {
    const en = require("../locales/en.json");
    const zhHans = require("../locales/zh-Hans.json");

    const requiredKeys = [
      "settings.appearance.language",
      "settings.omp.title",
      "settings.omp.description",
      "onboarding.providerSelect.omp",
      "onboarding.providerSelect.ompDesc",
      "omp.todo.title",
      "omp.todo.requests",
      "omp.todo.tokens",
      "omp.todo.subagentsActive",
      "omp.subagent.title",
      "omp.subagent.requests",
      "omp.subagent.tokens",
      "resources.send.title",
      "resources.send.description",
      "resources.send.send",
      "resources.send.cancel",
      "omp.featureCenter.loading",
      "omp.featureCenter.refresh",
      "omp.featureCenter.save",
    ];

    for (const key of requiredKeys) {
      expect(en[key]).toBeTruthy();
      expect(zhHans[key]).toBeTruthy();
    }
  });
});
