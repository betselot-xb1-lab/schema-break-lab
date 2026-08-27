// Do not import the producer's type here. This represents an independently deployed client.
export interface ExpectedCustomer {
  customerId: string;
  customerName: string;
}

export class ProducerContractError extends Error {
  constructor(public readonly field: keyof ExpectedCustomer) {
    super(`Producer contract violation: ${field} must be a string`);
    this.name = "ProducerContractError";
  }
}

export function readCustomer(payload: unknown): ExpectedCustomer {
  const object = typeof payload === "object" && payload !== null ? payload as Record<string, unknown> : {};
  if (typeof object.customerId !== "string") throw new ProducerContractError("customerId");
  if (typeof object.customerName !== "string") throw new ProducerContractError("customerName");
  return { customerId: object.customerId, customerName: object.customerName };
}

export function makeReport(payload: unknown) {
  const customer = readCustomer(payload);
  return { customerId: customer.customerId, displayName: customer.customerName.toUpperCase() };
}
