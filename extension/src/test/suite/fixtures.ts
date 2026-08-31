import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { PublishedFeature } from "../../registry";
import { Catalog, buildCatalog } from "../../catalog";

/** A throwaway checkout carrying the named files, each path relative to `.devcontainer`. */
export function tempCheckout(files: Record<string, string> = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "o3s-"));
  for (const [name, contents] of Object.entries(files)) {
    const file = path.join(root, ".devcontainer", name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents, "utf8");
  }
  return root;
}

export const removeCheckout = (root: string): void =>
  fs.rmSync(root, { recursive: true, force: true });

/** Two real collections, and the ids the suites reach for by name. */
export const OURS = "ghcr.io/hansehart/devcontainer-features";
export const THEIRS = "ghcr.io/devcontainers/features";

export const CLAUDE = `${OURS}/claude-code`;
export const GITHUB = `${THEIRS}/github-cli`;
export const DIND = `${THEIRS}/docker-in-docker`;

/** Trimmed to the fields the suites assert on, but shaped as a collection publishes them. */
export const PUBLISHED: Record<string, PublishedFeature[]> = {
  [OURS]: [
    {
      id: "claude-code",
      version: "1.2.0",
      name: "Claude Code CLI",
      description: "Installs the Claude Code CLI on a selectable channel.",
      documentationURL: `https://github.com/hansehart/devcontainer-features/tree/main/src/claude-code`,
      options: {
        version: { type: "string", proposals: ["latest", "stable"], default: "latest" },
        stateDir: { type: "string", default: "", description: "Where state is kept." },
        disableNonessentialTraffic: { type: "boolean", default: false },
      },
    },
  ],
  [THEIRS]: [
    {
      id: "github-cli",
      version: "1.0.14",
      name: "GitHub CLI",
      description: "Installs the GitHub CLI (gh).",
      options: {
        version: { type: "string", enum: ["latest", "2.0"], default: "latest" },
      },
    },
    {
      // Carries what a sandbox wants flagged, and a boolean to render.
      id: "docker-in-docker",
      version: "2.0.0",
      name: "Docker in Docker",
      description: "Installs a Docker engine.",
      privileged: true,
      capAdd: ["SYS_PTRACE"],
      customizations: { vscode: { extensions: ["ms-azuretools.vscode-docker"] } },
      options: {
        version: { type: "string", default: "latest" },
        moby: { type: "boolean", default: true, description: "Use the Moby build." },
      },
    },
  ],
};

export const CATALOG: Catalog = buildCatalog(
  [OURS, THEIRS],
  new Map(Object.entries(PUBLISHED))
);

export const entryFor = (base: string) => {
  const entry = CATALOG.find((candidate) => candidate.base === base);
  if (!entry) {
    throw new Error(`no fixture entry for ${base}`);
  }
  return entry;
};
