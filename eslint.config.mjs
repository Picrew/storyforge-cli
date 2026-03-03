import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**"]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["packages/cli/src/**/*.{ts,tsx}", "test/**/*.{ts,tsx}", "vitest.config.ts"],
    languageOptions: {
      globals: {
        ...globals.node,
        afterEach: "readonly",
        describe: "readonly",
        expect: "readonly",
        it: "readonly",
        vi: "readonly"
      },
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: {
          jsx: true
        }
      }
    },
    rules: {
      "no-console": [
        "error",
        {
          allow: ["error"]
        }
      ]
    }
  }
);
