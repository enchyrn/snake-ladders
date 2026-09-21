import type { Tokens } from "@pandacss/dev"

/**
 * Types the generated-token boundary. Without it `panda.config.ts` imports an
 * untyped `.mjs` and fails `noImplicitAny` — latent until Task 4's recipe test
 * imported the config and pulled it into the tsc program for the first time.
 */
export declare const colourTokens: NonNullable<Tokens["colors"]>
