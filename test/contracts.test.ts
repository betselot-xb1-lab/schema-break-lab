import { test } from "node:test";
import assert from "node:assert/strict";
import { makeReport, ProducerContractError } from "../src/consumer/customer-contract.js";
import { exampleCustomer } from "../src/producer/customer-schema.js";

test("the original compatible payload still satisfies the independently owned consumer contract", () => {
  assert.deepEqual(makeReport({ customerId: "synthetic-001", customerName: "Example Customer" }), { customerId: "synthetic-001", displayName: "EXAMPLE CUSTOMER" });
});

test("the current producer deliberately violates the unchanged consumer contract", () => {
  const payload = exampleCustomer();
  assert.deepEqual(payload, { customerId: "synthetic-001", fullName: "Example Customer" });
  assert.equal(Object.hasOwn(payload, "customerName"), false);
  assert.throws(() => makeReport(payload), (error: unknown) => error instanceof ProducerContractError && error.field === "customerName");
});

for (const [name, payload, field] of [
  ["removed field", { customerId: "synthetic-001" }, "customerName"],
  ["renamed field", { customerId: "synthetic-001", fullName: "Example Customer" }, "customerName"],
  ["retyped field", { customerId: "synthetic-001", customerName: 12 }, "customerName"],
  ["null payload", null, "customerId"],
] as const) {
  test(`consumer rejects ${name} instead of silently substituting a value`, () => {
    assert.throws(() => makeReport(payload), (error: unknown) => error instanceof ProducerContractError && error.field === field);
  });
}
