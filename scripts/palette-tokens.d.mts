// panda.config.ts imports this module by its runtime ".mjs" specifier, which
// tsc's "bundler" resolution cannot type from JS alone. This sibling
// declaration is the least surprising fix: the generator keeps producing
// plain values, and every consumer (panda's own codegen and this recipe
// test) sees a real type instead of an implicit `any`.
export declare const colourTokens: Record<string, { value: string } | Record<string, { value: string }>>
