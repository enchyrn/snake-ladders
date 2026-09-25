import nx from "@nx/eslint-plugin"
import tseslint from "typescript-eslint"

/**
 * The one job this config has is to make the `layer:*` tags mean something.
 *
 * The split into `apps/` and `packages/` looked like it established boundaries,
 * but aliases resolve in every direction, so `ui` importing `app-shell` and a
 * `net` test importing `app-shell` were invisible rather than blocked — two
 * cycles that only stayed harmless because no library defines a real `build`
 * target yet. Tags alone are labels; `enforce-module-boundaries` is the rule
 * that reads them, so without this file nothing stops `engine` importing the
 * HUD tomorrow, and the determinism contract cannot survive that.
 *
 * Each layer lists what it may reach *down* to, and nothing lists a layer above
 * itself — that is the whole design. The one edge that reads oddly is
 * `net -> relay`: the websocket tests run against the real `lan-relay.mjs`
 * rather than a fake, which is deliberate, because a fake sequencer would not
 * catch the two speaking different frames.
 */
export default [
  {
    ignores: [
      "**/node_modules/**",
      "dist/**",
      "screenshots/**",
      "src-tauri/gen/**",
      "src-tauri/target/**",
      "target/**",
      "**/*.d.ts",
    ],
  },
  { plugins: { "@nx": nx } },
  // Parsing only — no type-aware linting and no stylistic rules. The boundary
  // rule reads import statements, and tsc already owns everything else.
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: { parser: tseslint.parser },
  },
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", "**/*.mjs"],
    rules: {
      "@nx/enforce-module-boundaries": [
        "error",
        {
          enforceBuildableLibDependency: true,
          // Nx forbids importing an application at all, whatever the tags say,
          // and `relay` is one. `lan-relay.mjs` is dual-purpose: the runnable
          // relay *and* the sequencer the websocket tests run against. Testing
          // against a fake would defeat the point, since the whole risk is the
          // two implementations drifting into different frames. Declared here
          // so the exception is one visible line rather than a `../../../..`
          // that reaches past the rule unseen. Splitting the sequencer out of
          // the executable would retire it.
          // `../../../../panda.config` (packages/ui/src/__tests__/button-recipe.test.ts):
          // the button recipe's test pins the config as actually defined, so
          // it has to read panda.config.ts directly rather than the
          // generated output. That file sits at the workspace root, outside
          // every project, so the boundary rule can never resolve it to a
          // target project — `allow` is the one thing this rule checks
          // before that resolution even happens.
          allow: ["@mutation/relay", "../../../../panda.config"],
          depConstraints: [
            // The reducer is the bottom of the world. It may import nothing
            // internal at all: every rule in CLAUDE.md's determinism contract
            // rests on it staying a pure function of its own inputs.
            { sourceTag: "layer:engine", onlyDependOnLibsWithTags: [] },
            { sourceTag: "layer:render", onlyDependOnLibsWithTags: ["layer:engine"] },
            {
              sourceTag: "layer:ui",
              onlyDependOnLibsWithTags: ["layer:engine", "layer:render"],
            },
            {
              sourceTag: "layer:net",
              onlyDependOnLibsWithTags: ["layer:engine", "layer:relay"],
            },
            {
              sourceTag: "layer:app-shell",
              onlyDependOnLibsWithTags: [
                "layer:engine",
                "layer:net",
                "layer:render",
                "layer:ui",
              ],
            },
            // The app composes everything and is depended on by nothing.
            {
              sourceTag: "layer:app",
              onlyDependOnLibsWithTags: [
                "layer:engine",
                "layer:net",
                "layer:render",
                "layer:ui",
                "layer:app-shell",
                // drive-app.mjs lives in `tooling`; its serving rules are
                // unit-tested from the app that is served.
                "layer:tooling",
              ],
            },
            { sourceTag: "layer:relay", onlyDependOnLibsWithTags: [] },
            { sourceTag: "layer:native", onlyDependOnLibsWithTags: [] },
            { sourceTag: "layer:tooling", onlyDependOnLibsWithTags: [] },
          ],
        },
      ],
    },
  },
]
