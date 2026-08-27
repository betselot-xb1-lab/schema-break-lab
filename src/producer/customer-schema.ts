// Hand-written producer contract. The consumer deliberately owns a separate contract.
export interface Customer {
  customerId: string;
  fullName: string;
}

export function exampleCustomer(): Customer {
  return { customerId: "synthetic-001", fullName: "Example Customer" };
}
