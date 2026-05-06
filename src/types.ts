import z from "zod";

type TPortal = "casas-sapo" | "casa-yes" | "super-casa";
type TRunMode = "scrap" | "notify";
type TRunBehavior = {
  stopOnKnown: boolean;
};

const property = z.object({
  portal: z.enum([
    "casas-sapo",
    "casa-yes",
    "super-casa",
    "remax",
    "idealista",
    "imovirtual",
    "custo-justo",
  ]),
  uuid: z.string(),
  ref: z.string().optional(),
  title: z.string(),
  description: z.string().optional(),
  price: z.number(),
  location: z.string(),
  link: z.url(),
  energyEfficiency: z.string().optional(),
  photos: z.array(z.url()).optional(),
  lastUpdated: z.number().optional(),
});

type TSearchOptions = {
  type: string[];
  minPrice: number;
  maxPrice: number;
  city: string;
  stopOnKnown?: boolean;
  onNewProperty?: (property: TProperty) => void;
};

type TProperty = z.infer<typeof property>;

interface IScrapper {
  id: string;
  scrap(options: TSearchOptions): Promise<TProperty[]>;
  scrapProperty(url: string): Promise<TProperty>;
  buildUrl(options: TSearchOptions): string;
  getPagination(url: string): Promise<TPaginationResult>;
}

type TPaginationResult = {
  links: string[];
  nextPageUrl?: string;
};

export { property };
export type {
  TPortal,
  TRunBehavior,
  TRunMode,
  TSearchOptions,
  TProperty,
  IScrapper,
  TPaginationResult,
};
