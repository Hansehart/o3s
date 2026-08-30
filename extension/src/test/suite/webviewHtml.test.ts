import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";
import { WebviewAssets, featuresHtml, openProjectHtml } from "../../webviewHtml";
import { CATALOG, CLAUDE, GITHUB } from "./fixtures";
import { themeCss } from "./theme";

const CHROME = "chrome-headless-shell";
const MEDIA = path.resolve(__dirname, "..", "..", "..", "media");

const ASSETS: WebviewAssets = {
  cspSource: "file:",
  styleUri: `file://${path.join(MEDIA, "main.css")}`,
  scriptUri: `file://${path.join(MEDIA, "main.js")}`,
  logoUri: `file://${path.join(MEDIA, "icon.png")}`,
};

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
`;

/**
 * Renders a page in headless Chrome, runs `driver` inside it, and returns the
 * resulting DOM. The driver reports findings via `report(name, value)`, which
 * this reads back out of `data-probe` attributes.
 *
 * The stub goes in `<head>` so the page's own script finds `acquireVsCodeApi`
 * already defined, and the theme is linked rather than inlined so the page's
 * `style-src` applies to it unchanged.
 */
function render(html: string, driver: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "o3s-webview-"));
  try {
    // From the CSP rather than a script tag, since a page need not carry a script.
    const nonce = /'nonce-([^']+)'/.exec(html)?.[1] ?? "";
    const theme = path.join(dir, "theme.css");
    fs.writeFileSync(theme, themeCss(), "utf8");

    const page = html
      .replace(
        "</head>",
        `<link href="file://${theme}" rel="stylesheet">
         <script nonce="${nonce}">${VSCODE_API_STUB}</script></head>`
      )
      .replace("</body>", `<script nonce="${nonce}">${driver}</script></body>`);

    const file = path.join(dir, "page.html");
    fs.writeFileSync(file, page, "utf8");
    return execFileSync(
      CHROME,
      ["--no-sandbox", "--disable-gpu", "--dump-dom", `file://${file}`],
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

suite("webviewHtml (rendered)", () => {
  test("features page renders one card per catalog entry", () => {
    const html = featuresHtml(ASSETS, CATALOG, new Set());
    const dom = render(html, `report("cards", document.querySelectorAll(".feature-card").length);`);
    assert.strictEqual(probe(dom, "cards"), "2");
  });

  test("the selected set arrives as checked toggles", () => {
    const html = featuresHtml(ASSETS, CATALOG, new Set([GITHUB]));
    const dom = render(
      html,
      `report("checked", [...document.querySelectorAll("input:checked")].map(i => i.value));`
    );
    assert.strictEqual(probe(dom, "checked"), JSON.stringify([GITHUB]));
  });

  test("the counter tracks toggles as they are clicked", () => {
    const html = featuresHtml(ASSETS, CATALOG, new Set());
    const dom = render(
      html,
      `report("before", document.getElementById("count").textContent);
       document.querySelector("input[type=checkbox]").click();
       report("after", document.getElementById("count").textContent);`
    );
    assert.strictEqual(probe(dom, "before"), "0 of 2 selected");
    assert.strictEqual(probe(dom, "after"), "1 of 2 selected");
  });

  test("Generate posts the checked ids to the extension", () => {
    const html = featuresHtml(ASSETS, CATALOG, new Set([CLAUDE]));
    const dom = render(
      html,
      `document.getElementById("generate").click();
       report("posted", posted);`
    );
    assert.strictEqual(
      probe(dom, "posted"),
      JSON.stringify([{ type: "generate", selected: [CLAUDE] }])
    );
  });

  test("the toggles are actually visible once themed", () => {
    const html = featuresHtml(ASSETS, CATALOG, new Set());
    const dom = render(
      html,
      `const slider = document.querySelector(".slider");
       const box = slider.getBoundingClientRect();
       report("size", [Math.round(box.width), Math.round(box.height)]);
       report("background", getComputedStyle(slider).backgroundColor);`
    );
    const [width, height] = JSON.parse(probe(dom, "size") ?? "[0,0]") as number[];
    assert.ok(width > 0 && height > 0, `slider has no box: ${width}x${height}`);
    assert.notStrictEqual(probe(dom, "background"), "rgba(0, 0, 0, 0)");
  });

  test("clone page wires its button to a clone message", () => {
    const dom = render(
      openProjectHtml(ASSETS),
      `document.getElementById("clone").click();
       report("posted", posted);`
    );
    assert.strictEqual(probe(dom, "posted"), JSON.stringify([{ type: "clone" }]));
  });

});
