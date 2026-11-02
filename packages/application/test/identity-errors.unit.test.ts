import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ApplicationError,
  IdentityClaimsValidationError,
  IdentityPersistenceError,
  IdentityProvisioningRaceError,
  IdentityUnavailableError,
  type IdentityClaimField,
} from '../src/errors.js';

describe('Identity Error Constructor Contracts & Fields', () => {
  const FORBIDDEN_FIELDS = [
    'provider',
    'identityProvider',
    'subject',
    'identitySubject',
    'email',
    'displayName',
    'userId',
    'status',
    'sql',
    'bind',
  ];

  it('directly constructs each error with fixed approved messages and inheritance', () => {
    const claimFields: IdentityClaimField[] = [
      'claims',
      'identityProvider',
      'identitySubject',
      'email',
      'displayName',
    ];
    for (const field of claimFields) {
      const err = new IdentityClaimsValidationError(field);
      expect(err.message).toBe('Invalid identity claims');
      expect(err.name).toBe('IdentityClaimsValidationError');
      expect(err.code).toBe('IDENTITY_CLAIMS_INVALID');
      expect(err.field).toBe(field);
      expect(err).toBeInstanceOf(ApplicationError);
      expect(err).toBeInstanceOf(Error);
    }

    const unavailErr = new IdentityUnavailableError();
    expect(unavailErr.message).toBe('Identity is unavailable');
    expect(unavailErr.name).toBe('IdentityUnavailableError');
    expect(unavailErr.code).toBe('IDENTITY_UNAVAILABLE');
    expect(unavailErr).toBeInstanceOf(ApplicationError);

    const ops = ['lookup', 'insert', 'recovery'] as const;
    for (const op of ops) {
      const persistErr = new IdentityPersistenceError(op);
      expect(persistErr.message).toBe('Identity persistence error');
      expect(persistErr.name).toBe('IdentityPersistenceError');
      expect(persistErr.code).toBe('IDENTITY_PERSISTENCE_INVALID');
      expect(persistErr.operation).toBe(op);
      expect(persistErr).toBeInstanceOf(ApplicationError);
    }

    const raceErr = new IdentityProvisioningRaceError();
    expect(raceErr.message).toBe('Concurrent identity provisioning race detected');
    expect(raceErr.name).toBe('IdentityProvisioningRaceError');
    expect(raceErr.code).toBe('IDENTITY_PROVISIONING_RACE');
    expect(raceErr.retryable).toBe(true);
    expect(raceErr).toBeInstanceOf(ApplicationError);
  });

  it('exposes only approved public properties and no sensitive metadata fields', () => {
    const errors = [
      new IdentityClaimsValidationError('claims'),
      new IdentityUnavailableError(),
      new IdentityPersistenceError('lookup'),
      new IdentityProvisioningRaceError(),
    ];

    for (const err of errors) {
      for (const field of FORBIDDEN_FIELDS) {
        expect((err as unknown as Record<string, unknown>)[field]).toBeUndefined();
      }
    }

    const claimErr = new IdentityClaimsValidationError('claims');
    expect(claimErr.code).toBe('IDENTITY_CLAIMS_INVALID');
    expect(claimErr.field).toBe('claims');
    expect((claimErr as unknown as Record<string, unknown>).operation).toBeUndefined();
    expect((claimErr as unknown as Record<string, unknown>).retryable).toBeUndefined();

    const unavailErr = new IdentityUnavailableError();
    expect(unavailErr.code).toBe('IDENTITY_UNAVAILABLE');
    expect((unavailErr as unknown as Record<string, unknown>).field).toBeUndefined();
    expect((unavailErr as unknown as Record<string, unknown>).operation).toBeUndefined();
    expect((unavailErr as unknown as Record<string, unknown>).retryable).toBeUndefined();

    const persistErr = new IdentityPersistenceError('insert');
    expect(persistErr.code).toBe('IDENTITY_PERSISTENCE_INVALID');
    expect(persistErr.operation).toBe('insert');
    expect((persistErr as unknown as Record<string, unknown>).field).toBeUndefined();
    expect((persistErr as unknown as Record<string, unknown>).retryable).toBeUndefined();

    const raceErr = new IdentityProvisioningRaceError();
    expect(raceErr.code).toBe('IDENTITY_PROVISIONING_RACE');
    expect(raceErr.retryable).toBe(true);
    expect((raceErr as unknown as Record<string, unknown>).field).toBeUndefined();
    expect((raceErr as unknown as Record<string, unknown>).operation).toBeUndefined();
  });

  it('proves generated TypeScript declaration output contains no arbitrary message parameter', () => {
    const dtsPath = path.resolve(process.cwd(), 'packages/application/dist/errors.d.ts');
    if (!fs.existsSync(dtsPath)) {
      execSync('npx tsc -p tsconfig.build.json', {
        cwd: path.resolve(process.cwd(), 'packages/application'),
        stdio: 'pipe',
      });
    }
    const dtsContent = fs.readFileSync(dtsPath, 'utf8');

    expect(dtsContent).toMatch(
      /export declare class IdentityClaimsValidationError extends ApplicationError\s*\{[\s\S]*?constructor\(field: IdentityClaimField\);/,
    );
    expect(dtsContent).toMatch(
      /export declare class IdentityUnavailableError extends ApplicationError\s*\{[\s\S]*?constructor\(\);/,
    );
    expect(dtsContent).toMatch(
      /export declare class IdentityPersistenceError extends ApplicationError\s*\{[\s\S]*?constructor\(operation: 'lookup' \| 'insert' \| 'recovery'\);/,
    );
    expect(dtsContent).toMatch(
      /export declare class IdentityProvisioningRaceError extends ApplicationError\s*\{[\s\S]*?constructor\(\);/,
    );

    const identityBlock = dtsContent.slice(dtsContent.indexOf('IdentityClaimsValidationError'));
    expect(identityBlock).not.toMatch(/constructor\([^)]*message/);
  });
});
