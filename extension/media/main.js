//@ts-check
/// <reference types="vscode-webview" />

// This script runs inside the webview itself; it cannot access the VS Code APIs directly.
(function () {
  const vscode = acquireVsCodeApi();
  const total = Number(document.currentScript?.dataset.total ?? 0);
  const checkboxes = /** @type {HTMLInputElement[]} */ (Array.from(document.querySelectorAll("#features input")));
  const count = /** @type {HTMLElement} */ (document.getElementById("count"));

  function updateCount() {
    const n = checkboxes.filter((el) => el.checked).length;
    count.textContent = n + " of " + total + " selected";
  }
  checkboxes.forEach((el) => el.addEventListener("change", updateCount));
  updateCount();

  const generate = /** @type {HTMLElement} */ (document.getElementById("generate"));
  generate.addEventListener("click", () => {
    const selected = checkboxes.filter((el) => el.checked).map((el) => el.value);
    vscode.postMessage({ type: "generate", selected });
  });
})();
