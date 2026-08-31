import * as vscode from "vscode";
import { report } from "./log";

/** HTTPS, so the clone travels the path the gateway injects GH_TOKEN into. */
const REPO_URL = "https://github.com/Hansehart/o3s.git";

/** Hands the clone to the built-in Git extension, which the command and the button share. */
export async function cloneRepository(log: vscode.LogOutputChannel): Promise<void> {
  log.info("executing git.clone");
  try {
    await vscode.commands.executeCommand("git.clone", REPO_URL);
  } catch (error) {
    report(log, "could not clone o3s", error);
  }
}
