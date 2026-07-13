/**
 * Cross-platform resources copy script.
 *
 * Ensures the current platform's bundled uv binary exists before copying
 * resources into dist, so packaged Python-backed document tools can run.
 */

import { existsSync, cpSync, rmSync } from "fs";
import { join } from "path";
import { downloadUv, type Arch, type Platform } from "./build/common";

const ROOT_DIR = join(import.meta.dir, "..");
const ELECTRON_DIR = join(ROOT_DIR, "apps/electron");

const srcDir = join(ELECTRON_DIR, "resources");
const destDir = join(ELECTRON_DIR, "dist/resources");

function resolveBuildPlatform(): Platform {
  if (process.platform === "darwin") return "darwin";
  if (process.platform === "win32") return "win32";
  if (process.platform === "linux") return "linux";
  throw new Error(`Unsupported platform for uv bootstrap: ${process.platform}`);
}

function resolveBuildArch(): Arch {
  if (process.arch === "arm64") return "arm64";
  if (process.arch === "x64") return "x64";
  throw new Error(`Unsupported architecture for uv bootstrap: ${process.arch}`);
}

await downloadUv({
  platform: resolveBuildPlatform(),
  arch: resolveBuildArch(),
  upload: false,
  uploadLatest: false,
  uploadScript: false,
  rootDir: ROOT_DIR,
  electronDir: ELECTRON_DIR,
});

if (existsSync(srcDir)) {
  cpSync(srcDir, destDir, { recursive: true, force: true });
  // Keep developer-only smoke tests and local context files out of the
  // installed application. The source copies remain available to CI.
  rmSync(join(destDir, "AGENTS.md"), { force: true });
  rmSync(join(destDir, "scripts/tests"), { recursive: true, force: true });
  console.log("Copied resources to dist");
} else {
  console.log("No resources directory found");
}
