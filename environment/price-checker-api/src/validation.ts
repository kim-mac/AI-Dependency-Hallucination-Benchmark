import { z } from 'zod';

export const productSchema = z.object({
  productId: z.string().nonempty(),
});
