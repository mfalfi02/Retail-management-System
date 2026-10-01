export function assertDemoSeedEnvironment(nodeEnv: string | undefined) {
  if (nodeEnv === "production") {
    throw new Error("The development demo seed is disabled in production.");
  }
}
