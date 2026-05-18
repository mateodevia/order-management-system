/** A single line item in an order (product + requested quantity). */
export type OrderItem = {
  productId: string;
  quantity: number;
};
