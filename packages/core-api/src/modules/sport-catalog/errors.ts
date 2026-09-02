export class SportCatalogError extends Error {
  constructor(
    message: string,
    readonly code: string = 'SPORT_CATALOG_INVALID',
    readonly statusCode: number = 422,
  ) {
    super(message);
    this.name = 'SportCatalogError';
  }
}
