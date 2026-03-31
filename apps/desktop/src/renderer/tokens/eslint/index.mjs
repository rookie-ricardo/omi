import noFloatingZTokensInIsland from "./rules/no-floating-z-tokens-in-island.cjs";
import noHardcodedZIndex from "./rules/no-hardcoded-z-index.cjs";
import noNonstandardShadows from "./rules/no-nonstandard-shadows.cjs";

export const rules = {
  "no-hardcoded-z-index": noHardcodedZIndex,
  "no-floating-z-tokens-in-island": noFloatingZTokensInIsland,
  "no-nonstandard-shadows": noNonstandardShadows,
};

export default {
  rules,
};
