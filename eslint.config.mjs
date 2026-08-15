import js from "@eslint/js";
import stylistic from "@stylistic/eslint-plugin";
import typescriptEslint from "@typescript-eslint/eslint-plugin";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";

/** @type {import("eslint").Linter.RulesRecord} */
const commonRules = {
    "@stylistic/semi": ["error", "always"],
    curly: "error",
    eqeqeq: "error",
};

const recommendedTypeChecked = typescriptEslint.configs["flat/recommended-type-checked"];
if (!Array.isArray(recommendedTypeChecked)) {
    throw new Error("The recommended type-checked ESLint flat configuration is unavailable.");
}

export default defineConfig([
    globalIgnores([
        "out/",
        "dist/",
        ".vscode-test/",
        ".vscode-test-web/",
    ]),
    {
        name: "Node.js scripts",
        files: ["**/*.mjs"],
        extends: [js.configs.recommended],
        plugins: {
            "@stylistic": stylistic,
        },
        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "module",
            globals: globals.nodeBuiltin,
        },
        rules: {
            ...commonRules,
            "no-throw-literal": "error",
        },
    },
    {
        name: "TypeScript",
        files: ["**/*.ts"],
        extends: [recommendedTypeChecked],
        plugins: {
            "@stylistic": stylistic,
        },
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            ...commonRules,
            "@typescript-eslint/naming-convention": ["error", {
                selector: "import",
                format: ["camelCase", "PascalCase"],
            }],
            "@typescript-eslint/no-deprecated": "error",
            "@typescript-eslint/no-unused-vars": ["error", {
                args: "all",
                argsIgnorePattern: "^_",
                caughtErrors: "all",
                caughtErrorsIgnorePattern: "^_",
                destructuredArrayIgnorePattern: "^_",
                ignoreRestSiblings: true,
                varsIgnorePattern: "^_",
            }],
            "@typescript-eslint/restrict-plus-operands": ["error", {
                allowAny: false,
                allowBoolean: false,
                allowNullish: false,
                allowNumberAndString: false,
                allowRegExp: false,
            }],
        },
    },
]);
