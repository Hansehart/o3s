import { Catalog } from "../../devcontainerGenerator";

/** Two real feature ids - one o3s-published, one upstream - and the catalog they form. */
export const CLAUDE = "ghcr.io/hansehart/devcontainer-features/claude-code:1";
export const GITHUB = "ghcr.io/devcontainers/features/github-cli:1";

export const CATALOG: Catalog = {
  [CLAUDE]: {
    label: "Claude Code CLI",
    description: "Installs the Claude Code CLI on a selectable channel.",
    options: { version: "latest" },
  },
  [GITHUB]: {
    label: "GitHub CLI",
    description: "Installs the GitHub CLI (gh).",
    options: { version: "latest" },
  },
};
