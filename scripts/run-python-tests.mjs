import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/** @param {Record<string, string | undefined>} env */
export function resolvePythonExecutable(env = process.env, platform = process.platform) {
  return env.PYTHON || env.PYTHON_EXECUTABLE || (platform === "win32" ? "python" : "python3");
}

export function pythonTestArgs() {
  return [
    "-m", "unittest", "discover", "-s", "reportingdash-canonical-bootstrap/tests", "-p", "test_*.py",
  ];
}

export function runPythonTests() {
  const result = spawnSync(resolvePythonExecutable(), pythonTestArgs(), {
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runPythonTests();
}
