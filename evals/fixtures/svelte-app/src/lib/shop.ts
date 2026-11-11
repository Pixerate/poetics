import { createContext } from "svelte";

export interface Shop {
  name: string;
  currency: string;
}

/** The shop the fixture's components render for, as a Svelte 5 context. */
export const [getShop, setShop] = createContext<Shop>();
