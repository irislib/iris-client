export const usingBuiltDist =
  process.env.IRIS_E2E_BUILT_DIST === "true" ||
  process.env.IRIS_E2E_BUILT_DIST === "1" ||
  process.env.IRIS_E2E_BUILT === "true" ||
  process.env.IRIS_E2E_BUILT === "1"
