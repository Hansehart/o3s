//@ts-check
/// <reference types="vscode-webview" />

// Runs inside the webview, talking to the extension over postMessage, and wires
// whichever controls the page it backs carries.
(function () {
  const vscode = acquireVsCodeApi();

  document.getElementById("clone")?.addEventListener("click", () => {
    vscode.postMessage({ type: "clone" });
  });

  document.getElementById("retry")?.addEventListener("click", () => {
    vscode.postMessage({ type: "refresh" });
  });

  // The two lists the features page carries, which everything below wires.
  const selected = /** @type {HTMLElement} */ (document.getElementById("selected"));
  const browse = /** @type {HTMLElement} */ (document.getElementById("browse"));
  if (!selected || !browse) {
    return;
  }

  const cards = () => /** @type {HTMLElement[]} */ (Array.from(document.querySelectorAll(".feature-card")));

  /** The card an event landed in, which every control and button sits inside. */
  const cardOf = (/** @type {HTMLElement} */ target) =>
    /** @type {HTMLElement} */ (target.closest(".feature-card"));

  const toggleOf = (/** @type {HTMLElement} */ card) =>
    /** @type {HTMLInputElement} */ (card.querySelector("input.toggle"));

  const controlsOf = (/** @type {HTMLElement} */ card) =>
    /** @type {(HTMLInputElement|HTMLSelectElement)[]} */ (
      Array.from(card.querySelectorAll("[data-option]"))
    );

  /**
   * A checkbox carries its value in `checked`, every other control in `value`.
   * @param {HTMLInputElement|HTMLSelectElement} control
   * @returns {control is HTMLInputElement}
   */
  const isCheckbox = (control) =>
    control instanceof HTMLInputElement && control.type === "checkbox";

  const valueOf = (/** @type {HTMLInputElement|HTMLSelectElement} */ control) =>
    isCheckbox(control) ? control.checked : control.value;

  const seedControl = (/** @type {HTMLInputElement|HTMLSelectElement} */ control) => {
    const seed = control.dataset.seed ?? "";
    if (isCheckbox(control)) {
      control.checked = seed === "true";
    } else {
      control.value = seed;
    }
  };

  const count = /** @type {HTMLElement} */ (document.getElementById("count"));

  /** Restates how much of the catalog is switched on. */
  function updateCount() {
    const all = cards();
    const on = all.filter((card) => toggleOf(card).checked).length;
    count.textContent = on + " of " + all.length + " selected";
  }

  /** The browse list shows one provider at a time; the selected list shows everything. */
  function applyProvider() {
    const active = document.querySelector(".provider.active");
    const collection = active instanceof HTMLElement ? active.dataset.provider : undefined;
    // Each browse card, shown when it belongs to the active provider.
    for (const card of Array.from(browse.querySelectorAll(".feature-card"))) {
      const shown = !collection || /** @type {HTMLElement} */ (card).dataset.collection === collection;
      /** @type {HTMLElement} */ (card).classList.toggle("hidden", !shown);
    }
  }

  /** Moves a card into the list its toggle names, where the selection stays visible throughout. */
  function place(/** @type {HTMLElement} */ card) {
    const on = toggleOf(card).checked;
    card.classList.toggle("on", on);
    (on ? selected : browse).appendChild(card);
    card.classList.remove("hidden");
    applyProvider();
  }

  document.addEventListener("change", (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.classList.contains("toggle")) {
      place(cardOf(target));
      updateCount();
    }
  });

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (target.classList.contains("provider")) {
      // Each tab, with the clicked one marked active.
      for (const provider of Array.from(document.querySelectorAll(".provider"))) {
        provider.classList.toggle("active", provider === target);
      }
      applyProvider();
      return;
    }

    if (target.classList.contains("reset")) {
      // Each control back to the seed the extension rendered it with.
      controlsOf(cardOf(target)).forEach(seedControl);
    }
  });

  document.getElementById("add-provider")?.addEventListener("click", () => {
    const field = /** @type {HTMLInputElement} */ (document.getElementById("provider-ref"));
    const ref = field.value.trim();
    if (ref) {
      vscode.postMessage({ type: "addProvider", ref });
    }
  });

  document.getElementById("generate")?.addEventListener("click", () => {
    // Each switched-on card, read back as the values its controls currently hold.
    const chosen = cards()
      .filter((card) => toggleOf(card).checked)
      .map((card) => ({
        base: card.dataset.base,
        values: Object.fromEntries(
          controlsOf(card).map((control) => [control.dataset.option, valueOf(control)])
        ),
      }));
    vscode.postMessage({ type: "generate", selected: chosen });
  });

  applyProvider();
  updateCount();
})();
