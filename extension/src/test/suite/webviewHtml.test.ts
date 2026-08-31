import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";
import { WebviewAssets, featuresHtml, openProjectHtml } from "../../webviewHtml";
import { CATALOG, CLAUDE, DIND, GITHUB, OURS, THEIRS, entryFor } from "./fixtures";
import { themeCss } from "./theme";

/** The headless browsers that answer `--dump-dom`, in the order the harness looks for them. */
const CHROME_CANDIDATES = ["chrome-headless-shell", "google-chrome", "chromium", "chromium-browser"];

function chromeBinary(): string {
  const dirs = (process.env.PATH ?? "").split(path.delimiter);
  for (const candidate of CHROME_CANDIDATES) {
    const found = dirs
      .map((dir) => path.join(dir, candidate))
      .find((binary) => fs.existsSync(binary));
    if (found) {
      return found;
    }
  }
  throw new Error(`no headless browser on PATH; tried ${CHROME_CANDIDATES.join(", ")}`);
}

const MEDIA = path.resolve(__dirname, "..", "..", "..", "media");

const ASSETS: WebviewAssets = {
  cspSource: "file:",
  styleUri: `file://${path.join(MEDIA, "main.css")}`,
  scriptUri: `file://${path.join(MEDIA, "main.js")}`,
  logoUri: `file://${path.join(MEDIA, "icon.png")}`,
};

/** The page as the provider builds it, with only the selection varying per test. */
const page = (selected: Record<string, Record<string, string | boolean>> = {}) =>
  featuresHtml(ASSETS, {
    catalog: CATALOG,
    collections: [OURS, THEIRS],
    selected: new Map(Object.entries(selected)),
  });

/** The `vscode` object a webview gets from the host, recording what the page sends. */
const VSCODE_API_STUB = `
  let posted = [];
  const acquireVsCodeApi = () => ({ postMessage: (m) => posted.push(m) });
  const report = (name, value) => {
    const el = document.createElement("div");
    el.setAttribute("data-probe", name);
    el.textContent = typeof value === "string" ? value : JSON.stringify(value);
    document.body.appendChild(el);
  };
  const card = (base) => document.querySelector('[data-base="' + base + '"]');
`;

/** Renders a page in headless Chrome, runs `driver` in it, and returns the DOM. */
function render(html: string, driver: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "o3s-webview-"));
  try {
    // From the CSP, which every page carries whether or not it has a script.
    const nonce = /'nonce-([^']+)'/.exec(html)?.[1] ?? "";
    const theme = path.join(dir, "theme.css");
    fs.writeFileSync(theme, themeCss(), "utf8");

    // The stub sits in `<head>` to precede the page's script; the theme is linked from
    // there too, so `style-src` covers it.
    const rendered = html
      .replace(
        "</head>",
        `<link href="file://${theme}" rel="stylesheet">
         <script nonce="${nonce}">${VSCODE_API_STUB}</script></head>`
      )
      // The driver runs last, once the page has wired itself up.
      .replace("</body>", `<script nonce="${nonce}">${driver}</script></body>`);

    const file = path.join(dir, "page.html");
    fs.writeFileSync(file, rendered, "utf8");
    return execFileSync(
      chromeBinary(),
      ["--headless", "--no-sandbox", "--disable-gpu", "--dump-dom", `file://${file}`],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Reads a probe back out of the dumped DOM, undoing the escaping serialization adds. */
const probe = (dom: string, name: string): string | undefined =>
  new RegExp(`data-probe="${name}"[^>]*>([^<]*)<`)
    .exec(dom)?.[1]
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

const json = (dom: string, name: string): unknown => JSON.parse(probe(dom, name) ?? "null");

suite("webviewHtml: the catalog", () => {
  test("renders one card per catalog entry", () => {
    const dom = render(page(), `report("cards", document.querySelectorAll(".feature-card").length);`);
    assert.strictEqual(probe(dom, "cards"), String(CATALOG.length));
  });

  test("what is already selected starts in the selected list, the rest in browse", () => {
    const dom = render(
      page({ [CLAUDE]: {} }),
      `report("selected", [...document.querySelectorAll("#selected [data-base]")].map(e => e.dataset.base));
       report("browse", [...document.querySelectorAll("#browse [data-base]")].map(e => e.dataset.base));`
    );
    assert.deepStrictEqual(json(dom, "selected"), [CLAUDE]);
    assert.deepStrictEqual(json(dom, "browse"), [GITHUB, DIND]);
  });

  test("the docs link points at what the feature published", () => {
    const dom = render(
      page(),
      `report("href", card("${CLAUDE}").querySelector("a.docs").getAttribute("href"));`
    );
    assert.strictEqual(probe(dom, "href"), entryFor(CLAUDE).documentationURL);
  });

  test("a feature that weakens isolation says so before it is enabled", () => {
    const dom = render(
      page(),
      `report("notes", [...card("${DIND}").querySelectorAll(".security li")].map(e => e.textContent));
       report("quiet", card("${GITHUB}").querySelectorAll(".security").length);`
    );
    assert.deepStrictEqual(json(dom, "notes"), ["runs privileged", "adds SYS_PTRACE"]);
    assert.strictEqual(probe(dom, "quiet"), "0");
  });
});

suite("webviewHtml: option controls", () => {
  const control = (base: string, option: string) =>
    `card("${base}").querySelector('[data-option="${option}"]')`;

  test("a boolean option is a checkbox at the published default", () => {
    const dom = render(
      page(),
      `const el = ${control(DIND, "moby")};
       report("type", el.type);
       report("checked", el.checked);`
    );
    assert.strictEqual(probe(dom, "type"), "checkbox");
    assert.strictEqual(probe(dom, "checked"), "true");
  });

  test("a closed enum is a select carrying exactly its choices", () => {
    const dom = render(
      page(),
      `const el = ${control(GITHUB, "version")};
       report("tag", el.tagName);
       report("choices", [...el.options].map(o => o.value));
       report("value", el.value);`
    );
    assert.strictEqual(probe(dom, "tag"), "SELECT");
    assert.deepStrictEqual(json(dom, "choices"), ["latest", "2.0"]);
    assert.strictEqual(probe(dom, "value"), "latest");
  });

  test("proposals are suggestions, so the field stays typeable", () => {
    const dom = render(
      page(),
      `const el = ${control(CLAUDE, "version")};
       report("tag", el.tagName);
       report("list", [...document.getElementById(el.getAttribute("list")).options].map(o => o.value));`
    );
    assert.strictEqual(probe(dom, "tag"), "INPUT");
    assert.deepStrictEqual(json(dom, "list"), ["latest", "stable"]);
  });

  test("a plain string is a text field", () => {
    const dom = render(page(), `report("type", ${control(DIND, "version")}.type);`);
    assert.strictEqual(probe(dom, "type"), "text");
  });

  test("a control starts at the feature's published default", () => {
    const dom = render(
      page(),
      `report("stateDir", ${control(CLAUDE, "stateDir")}.value);
       report("traffic", ${control(CLAUDE, "disableNonessentialTraffic")}.checked);`
    );
    assert.strictEqual(probe(dom, "stateDir"), "");
    assert.strictEqual(probe(dom, "traffic"), "false");
  });

  test("a value already in devcontainer.json wins over the seed", () => {
    const dom = render(
      page({ [CLAUDE]: { stateDir: "/elsewhere" } }),
      `report("stateDir", ${control(CLAUDE, "stateDir")}.value);`
    );
    assert.strictEqual(probe(dom, "stateDir"), "/elsewhere");
  });

  test("each control carries the option's own description", () => {
    const dom = render(
      page(),
      `report("desc", card("${CLAUDE}").querySelector('[data-describes="stateDir"]').textContent);`
    );
    assert.strictEqual(probe(dom, "desc"), "Where state is kept.");
  });

  test("reset puts the published defaults back after an edit", () => {
    const dom = render(
      page(),
      `${control(CLAUDE, "stateDir")}.value = "/scratch";
       ${control(CLAUDE, "disableNonessentialTraffic")}.checked = true;
       card("${CLAUDE}").querySelector(".reset").click();
       report("stateDir", ${control(CLAUDE, "stateDir")}.value);
       report("traffic", ${control(CLAUDE, "disableNonessentialTraffic")}.checked);`
    );
    assert.strictEqual(probe(dom, "stateDir"), "");
    assert.strictEqual(probe(dom, "traffic"), "false");
  });

  test("reset on a selected card returns to the default, not to what the file holds", () => {
    // The seed a control resets to is the feature's own default, whatever the file states.
    const dom = render(
      page({ [CLAUDE]: { stateDir: "/elsewhere" } }),
      `card("${CLAUDE}").querySelector(".reset").click();
       report("stateDir", ${control(CLAUDE, "stateDir")}.value);`
    );
    assert.strictEqual(probe(dom, "stateDir"), "");
  });
});

suite("webviewHtml: switching provider", () => {
  test("browse shows one provider at a time", () => {
    const visible = `[...document.querySelectorAll("#browse .feature-card")]
       .filter(e => e.offsetParent !== null).map(e => e.dataset.base)`;
    const dom = render(
      page(),
      `report("first", ${visible});
       document.querySelector('[data-provider="${THEIRS}"]').click();
       report("second", ${visible});`
    );
    assert.deepStrictEqual(json(dom, "first"), [CLAUDE]);
    assert.deepStrictEqual(json(dom, "second"), [GITHUB, DIND]);
  });

  test("a selected feature stays visible whichever provider is being browsed", () => {
    const dom = render(
      page({ [CLAUDE]: {} }),
      `document.querySelector('[data-provider="${THEIRS}"]').click();
       report("selected", [...document.querySelectorAll("#selected .feature-card")]
         .filter(e => e.offsetParent !== null).map(e => e.dataset.base));`
    );
    assert.deepStrictEqual(json(dom, "selected"), [CLAUDE]);
  });

  test("adding a provider asks the extension to fetch it", () => {
    const dom = render(
      page(),
      `document.getElementById("provider-ref").value = "ghcr.io/acme/features";
       document.getElementById("add-provider").click();
       report("posted", posted);`
    );
    assert.deepStrictEqual(json(dom, "posted"), [
      { type: "addProvider", ref: "ghcr.io/acme/features" },
    ]);
  });

  test("an empty provider field posts nothing", () => {
    const dom = render(
      page(),
      `document.getElementById("add-provider").click();
       report("posted", posted);`
    );
    assert.deepStrictEqual(json(dom, "posted"), []);
  });
});

suite("webviewHtml: generating", () => {
  test("enabling a feature moves it into the selected list", () => {
    const dom = render(
      page(),
      `card("${GITHUB}").querySelector('input[type="checkbox"].toggle').click();
       report("selected", [...document.querySelectorAll("#selected [data-base]")].map(e => e.dataset.base));`
    );
    assert.deepStrictEqual(json(dom, "selected"), [GITHUB]);
  });

  test("Generate posts each selected base with the values on its controls", () => {
    const dom = render(
      page({ [CLAUDE]: {} }),
      `card("${CLAUDE}").querySelector('[data-option="stateDir"]').value = "/custom";
       document.getElementById("generate").click();
       report("posted", posted);`
    );
    assert.deepStrictEqual(json(dom, "posted"), [
      {
        type: "generate",
        selected: [
          {
            base: CLAUDE,
            values: {
              version: "latest",
              stateDir: "/custom",
              disableNonessentialTraffic: false,
            },
          },
        ],
      },
    ]);
  });

  test("Generate ignores the features left switched off", () => {
    const dom = render(
      page(),
      `document.getElementById("generate").click();
       report("posted", posted);`
    );
    assert.deepStrictEqual(json(dom, "posted"), [{ type: "generate", selected: [] }]);
  });

  test("the counter tracks toggles as they are clicked", () => {
    const dom = render(
      page(),
      `report("before", document.getElementById("count").textContent);
       card("${GITHUB}").querySelector('input[type="checkbox"].toggle').click();
       report("after", document.getElementById("count").textContent);`
    );
    assert.strictEqual(probe(dom, "before"), `0 of ${CATALOG.length} selected`);
    assert.strictEqual(probe(dom, "after"), `1 of ${CATALOG.length} selected`);
  });

  test("the toggles are actually visible once themed", () => {
    const dom = render(
      page(),
      `const slider = document.querySelector(".slider");
       const box = slider.getBoundingClientRect();
       report("size", [Math.round(box.width), Math.round(box.height)]);
       report("background", getComputedStyle(slider).backgroundColor);`
    );
    const [width, height] = JSON.parse(probe(dom, "size") ?? "[0,0]") as number[];
    assert.ok(width > 0 && height > 0, `slider has no box: ${width}x${height}`);
    assert.notStrictEqual(probe(dom, "background"), "rgba(0, 0, 0, 0)");
  });
});

suite("webviewHtml: the clone page", () => {
  test("wires its button to a clone message", () => {
    const dom = render(
      openProjectHtml(ASSETS),
      `document.getElementById("clone").click();
       report("posted", posted);`
    );
    assert.deepStrictEqual(json(dom, "posted"), [{ type: "clone" }]);
  });
});
