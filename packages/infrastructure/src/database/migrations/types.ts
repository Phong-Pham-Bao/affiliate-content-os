export interface MigrationFile {
  readonly number: number;
  readonly name: string;
  readonly filename: string;
  readonly filepath: string;
  readonly sql: string;
  readonly checksumSha256: string;
}

export interface AppliedMigration {
  readonly migrationNumber: number;
  readonly name: string;
  readonly checksumSha256: string;
  readonly appliedAt: Date;
}

export interface MigrationStatus {
  readonly applied: readonly AppliedMigration[];
  readonly pending: readonly MigrationFile[];
  readonly isUpToDate: boolean;
}

export interface RunMigrationsOptions {
  readonly migrationsDir?: string | undefined;
  readonly onProgress?: ((migration: MigrationFile, durationMs: number) => void) | undefined;
}
