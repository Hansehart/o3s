import { PublishedFeature } from "../../registry";
import { Catalog, buildCatalog } from "../../catalog";

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

/** The o3s values that are not the feature's own, exactly as the sources file carries them. */
export const OVERRIDES = {
  [CLAUDE]: { stateDir: "/home/ubuntu/features/claude", disableNonessentialTraffic: true },
};

export const CATALOG: Catalog = buildCatalog(
  { collections: [OURS, THEIRS], overrides: OVERRIDES },
  new Map(Object.entries(PUBLISHED))
);

export const entryFor = (base: string) => {
  const entry = CATALOG.find((candidate) => candidate.base === base);
  if (!entry) {
    throw new Error(`no fixture entry for ${base}`);
  }
  return entry;
};
