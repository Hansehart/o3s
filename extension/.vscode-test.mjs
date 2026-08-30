import { defineConfig } from "@vscode/test-cli";

export default defineConfig({
  files: "out/test/**/*.test.js",
  // VS Code opens an IPC socket under the user data dir, and a unix socket path
  // caps at 107 characters, which a checkout nested a few levels deep exceeds.
  launchArgs: ["--user-data-dir", "/tmp/o3s-vscode-test"],
});
