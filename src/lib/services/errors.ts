export class BusinessRuleError extends Error {
  constructor(message: string, public readonly code = "BUSINESS_RULE") {
    super(message);
    this.name = "BusinessRuleError";
  }
}
