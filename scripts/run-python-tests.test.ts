import assert from "node:assert/strict";
import test from "node:test";
import {
  pythonTestArgs,
  resolvePythonExecutable,
} from "./run-python-tests.mjs";

test("Python test launcher supports an explicit executable and Windows fallback", () => {
  assert.equal(resolvePythonExecutable({ PYTHON: "custom-python" }, "linux"), "custom-python");
  assert.equal(resolvePythonExecutable({}, "win32"), "python");
  assert.equal(resolvePythonExecutable({}, "linux"), "python3");
  assert.deepEqual(pythonTestArgs(), [
    "-m", "unittest", "discover", "-s", "reportingdash-canonical-bootstrap/tests", "-p", "test_*.py",
  ]);
});
