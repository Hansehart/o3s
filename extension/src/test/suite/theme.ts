/**
 * The `--vscode-*` variables media/main.css reads, at their Dark Modern values. A webview
 * inherits these from the active theme; a rendered page is given them here instead.
 */
const DARK_THEME_VARIABLES: Readonly<Record<string, string>> = {
  "--vscode-font-family": "system-ui, sans-serif",
  "--vscode-font-size": "13px",
  "--vscode-foreground": "#cccccc",
  "--vscode-descriptionForeground": "#9d9d9d",
  "--vscode-editor-background": "#1f1f1f",
  "--vscode-sideBar-background": "#181818",
  "--vscode-panel-border": "#2b2b2b",
  "--vscode-widget-border": "#313131",
  "--vscode-focusBorder": "#0078d4",
  "--vscode-input-background": "#313131",
  "--vscode-input-border": "#3c3c3c",
  "--vscode-list-hoverBackground": "#2a2d2e",
  "--vscode-button-background": "#0078d4",
  "--vscode-button-foreground": "#ffffff",
  "--vscode-button-hoverBackground": "#026ec1",
};

/** The variables as a stylesheet, linked rather than inlined so `style-src` still holds. */
export function themeCss(): string {
  const declarations = Object.entries(DARK_THEME_VARIABLES)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join("\n");
  return `:root {\n${declarations}\n}\n`;
}
