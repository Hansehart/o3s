/**
 * ESLint configuration for the extension.
 *
 * See https://eslint.style and https://typescript-eslint.io for additional linting options.
 */
// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import stylistic from "@stylistic/eslint-plugin";

export default tseslint.config(
  {
    ignores: ["out", ".vscode-test"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...tseslint.configs.stylistic,
  {
    plugins: {
      "@stylistic": stylistic,
    },
    rules: {
      curly: "warn",
      "@stylistic/semi": ["warn", "always"],
      "@typescript-eslint/no-empty-function": "off",
      "@typescript-eslint/naming-convention": [
        "warn",
        {
          selector: "import",
          format: ["camelCase", "PascalCase"],
        },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    // media/ runs in the webview, not in Node: it gets the browser globals plus
    // the one the host injects, and the TypeScript rules do not apply to it.
    files: ["media/**/*.js"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: {
        acquireVsCodeApi: "readonly",
        document: "readonly",
      },
    },
  }
);
