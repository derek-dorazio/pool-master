import type { ApiErrorCode } from '@poolmaster/shared/dto';
export class SportCatalogError extends Error {
  constructor(
    message: string,
    readonly code: ApiErrorCode,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'SportCatalogError';
  }
}
