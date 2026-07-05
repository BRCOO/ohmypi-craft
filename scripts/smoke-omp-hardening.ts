import { spawn } from "bun";
import { join } from "node:path";
import { checkOmpRuntime } from "@craft-agent/shared/agent/backend";
import { getOmpCommandPath } from "@craft-agent/shared/config";

const ROOT_DIR = join(import.meta.dir, "..");
const args = new Set(process.argv.slice(2));
const BUN_EXE = process.versions.bun ? process.execPath : "bun";

async function runStep(name: string, cmd: string[]): Promise<void> {
  console.log(`\n▶ ${name}`);
  const proc = spawn({
    cmd,
    cwd: ROOT_DIR,
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`${name} failed with exit code ${exitCode}`);
  }
}

async function main(): Promise<void> {
  if (!args.has("--skip-build")) {
    await runStep("Electron main build", [BUN_EXE, "run", "electron:build:main"]);
  }

  if (args.has("--skip-omp")) {
    console.log("\n⏭️  OMP runtime check skipped");
    return;
  }

  console.log("\n▶ OMP runtime and model discovery");
  const status = await checkOmpRuntime({
    configuredCommand: getOmpCommandPath(),
    envCommand: process.env.OMP_COMMAND,
    cwd: ROOT_DIR,
    timeoutMs: 15_000,
  });

  if (!status.ok) {
    console.error(`❌ OMP runtime check failed (${status.errorCode ?? "unknown"}): ${status.error ?? "Unknown error"}`);
    if (args.has("--allow-missing-omp")) {
      console.warn("⚠️  Continuing because --allow-missing-omp was supplied");
      return;
    }
    process.exit(1);
  }

  console.log(`✅ OMP ready via ${status.source}: ${status.rawCommand}`);
  console.log(`✅ Models: ${status.modelCount ?? 0}${status.defaultModel ? ` (default: ${status.defaultModel})` : ""}`);
}

main().catch((error) => {
  console.error("❌ OMP hardening smoke failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
