-- A released edition joins each of its template contests by a background job (#1318).
ALTER TYPE "PrismaBackgroundJobType" ADD VALUE 'ADD_RELEASED_EDITION_TO_CONTEST';
