/** Same-origin, versioned release resources. Model geometry stays unmodified. */
export const assetUrl = (path: string) => `/rhine/${path.replace(/^\//,'')}`;
