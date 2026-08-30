//@ts-check
/// <reference types="vscode-webview" />

// This script runs inside the webview itself; it cannot access the VS Code APIs
// directly. It backs both pages, wiring whichever controls the page carries.
(function () {
  const vscode = acquireVsCodeApi();

  document.getElementById("clone")?.addEventListener("click", () => {
    vscode.postMessage({ type: "clone" });
  });

  const form = document.getElementById("features");
  if (!form) {
    return;
  }
  const checkboxes = /** @type {HTMLInputElement[]} */ (Array.from(form.querySelectorAll("input")));
  const count = /** @type {HTMLElement} */ (document.getElementById("count"));

  function updateCount() {
    const n = checkboxes.filter((el) => el.checked).length;
    count.textContent = n + " of " + checkboxes.length + " selected";
  }
  // One listener on the form rather than one per toggle; `change` bubbles.
  form.addEventListener("change", updateCount);
  updateCount();

  document.getElementById("generate")?.addEventListener("click", () => {
    const selected = checkboxes.filter((el) => el.checked).map((el) => el.value);
    vscode.postMessage({ type: "generate", selected });
  });
})();
