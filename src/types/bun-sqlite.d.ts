declare module "bun:sqlite" {
  export interface SQLiteRunResult {
    changes?: number;
    lastInsertRowid?: number;
  }

  export interface SQLiteStatement<T = unknown> {
    get(...params: unknown[]): T | undefined;
    all(...params: unknown[]): T[];
    run(...params: unknown[]): SQLiteRunResult;
  }

  export interface SQLiteDatabaseOptions {
    create?: boolean;
    readonly?: boolean;
    strict?: boolean;
  }

  export class Database {
    constructor(path?: string, options?: SQLiteDatabaseOptions);
    query<T = unknown>(sql: string): SQLiteStatement<T>;
    prepare<T = unknown>(sql: string): SQLiteStatement<T>;
    run(sql: string, ...params: unknown[]): SQLiteRunResult;
    exec(sql: string): void;
    close(): void;
    transaction<T extends (...args: never[]) => unknown>(callback: T): T;
  }
}
