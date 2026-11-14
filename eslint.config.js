import js from "@eslint/js";
import globals from "globals";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  { ignores: ["dist/**", "node_modules/**", ".vercel/**", ".agents/**", ".claude/**"] },
  js.configs.recommended,
  {
    files: ["src/**/*.{js,jsx,mjs}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser },
    },
    plugins: { react, "react-hooks": reactHooks },
    settings: { react: { version: "detect" } },
    rules: {
      ...react.configs.recommended.rules,
      ...react.configs["jsx-runtime"].rules,
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      // El proyecto no usa PropTypes ni TypeScript.
      "react/prop-types": "off",
      // Los textos de la interfaz llevan comillas tal cual ("Entregado").
      "react/no-unescaped-entities": "off",
      // `catch (e) {}` sin usar el error es un patrón deliberado en el proyecto.
      "no-unused-vars": ["error", { caughtErrors: "none" }],
      // Los regex del parser escapan de más (\- \/) a propósito, por legibilidad;
      // son inofensivos y no vale la pena tocar regex frágiles por estilo.
      "no-useless-escape": "off",
    },
  },
  {
    // Tests (node:test) y archivos de configuración corren en Node.
    files: ["src/**/*.test.mjs", "*.config.js"],
    languageOptions: { globals: { ...globals.node } },
  },
];
