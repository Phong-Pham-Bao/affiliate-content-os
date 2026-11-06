import { describe, expect, it } from 'vitest';
import {
  parseAuditEventId,
  parseIdempotencyKeyId,
  parseIsoTimestamp,
  parseMembershipId,
  parseUserId,
  parseWorkspaceId,
  type AuditEventId,
  type IdempotencyKeyId,
  type MembershipId,
  type UserId,
  type UserSnapshot,
  type WorkspaceId,
  type WorkspaceMembershipSnapshot,
  type WorkspaceSnapshot,
} from '@affiliate-content-os/domain';
import {
  createWorkspace,
  InactiveUserError,
  SlugConflictError,
  UserNotFoundError,
  ValidationError,
  type ClockPort,
  type CreateWorkspaceCommand,
  type CreateWorkspaceDependencies,
  type CreateWorkspaceIdempotencyInput,
  type CreateWorkspaceWithOwnerParams,
  type CreateWorkspaceResult,
  type IdGeneratorPort,
  type UserDirectoryPort,
  type WorkspacePersistencePort,
} from '../src/index.js';

class FakeClock implements ClockPort {
  constructor(public fixedTime: Date) {}
  public now(): Date {
    return new Date(this.fixedTime.getTime());
  }
}

class FakeIdGenerator implements IdGeneratorPort {
  public generateWorkspaceCalls = 0;
  public generateMembershipCalls = 0;

  constructor(
    private readonly workspaceId: WorkspaceId,
    private readonly membershipId: MembershipId,
    private readonly userId: UserId,
  ) {}
  public generateWorkspaceId(): WorkspaceId {
    this.generateWorkspaceCalls++;
    return this.workspaceId;
  }
  public generateMembershipId(): MembershipId {
    this.generateMembershipCalls++;
    return this.membershipId;
  }
  public generateUserId(): UserId {
    return this.userId;
  }
  public generateId(): string {
    return '0192b012-3456-789a-8bcd-ef0123456783';
  }
  public generateAuditEventId(): AuditEventId {
    return parseAuditEventId('0192b012-3456-789a-8bcd-ef0123456784');
  }
  public generateIdempotencyKeyId(): IdempotencyKeyId {
    return parseIdempotencyKeyId('0192b012-3456-789a-8bcd-ef0123456785');
  }
}

class FakeUserDirectory implements UserDirectoryPort {
  public users = new Map<string, UserSnapshot>();
  public calls: UserId[] = [];

  public async findUserById(userId: UserId): Promise<UserSnapshot | null> {
    this.calls.push(userId);
    return this.users.get(userId) ?? null;
  }
}

class FakeWorkspacePersistence implements WorkspacePersistencePort {
  public createCalls: CreateWorkspaceWithOwnerParams[] = [];
  public slugConflictOn?: string | undefined;

  public async createWorkspaceWithOwner(
    params: CreateWorkspaceWithOwnerParams,
  ): Promise<CreateWorkspaceResult> {
    this.createCalls.push(params);
    if (this.slugConflictOn && params.workspace.slug === this.slugConflictOn) {
      throw new SlugConflictError(params.workspace.slug);
    }
    return {
      workspace: params.workspace,
      membership: params.membership,
      idempotencyRecord: params.idempotencyRecord,
      auditEvent: params.auditEvent,
    };
  }

  public async findWorkspaceByIdForUser(): Promise<WorkspaceSnapshot | null> {
    return null;
  }

  public async findMembership(): Promise<WorkspaceMembershipSnapshot | null> {
    return null;
  }
}

describe('CreateWorkspace Use Case', () => {
  const fixedDateIso = '2026-10-25T12:00:00.000Z';
  const fixedDate = new Date(fixedDateIso);
  const validUserId = parseUserId('0192b012-3456-789a-8bcd-ef0123456780');
  const validWorkspaceId = parseWorkspaceId('0192b012-3456-789a-8bcd-ef0123456781');
  const validMembershipId = parseMembershipId('0192b012-3456-789a-8bcd-ef0123456782');

  function setupTestDeps() {
    const clock = new FakeClock(fixedDate);
    const idGenerator = new FakeIdGenerator(validWorkspaceId, validMembershipId, validUserId);
    const userDirectory = new FakeUserDirectory();
    const workspacePersistence = new FakeWorkspacePersistence();

    const activeUser: UserSnapshot = Object.freeze({
      id: validUserId,
      identityProvider: 'oidc.example.com',
      identitySubject: 'sub_123',
      email: 'user@example.com',
      displayName: 'Test User',
      status: 'active',
      createdAt: parseIsoTimestamp('2026-10-01T00:00:00.000Z'),
      updatedAt: parseIsoTimestamp('2026-10-01T00:00:00.000Z'),
      version: 1,
    });
    userDirectory.users.set(validUserId, activeUser);

    const deps: CreateWorkspaceDependencies = {
      clock,
      idGenerator,
      userDirectory,
      workspacePersistence,
    };

    const baseCommand: CreateWorkspaceCommand = {
      userId: validUserId,
      name: '  Acme Marketing  ',
      slug: '  Acme-Marketing-01  ',
      timezone: 'Asia/Ho_Chi_Minh',
      brandVoice: '  Punchy and direct  ',
      defaultDisclosure: '  #affiliate  ',
      aiEnabled: true,
      idempotency: {
        keyHash: new Uint8Array(32).fill(1),
        requestHash: new Uint8Array(32).fill(2),
      },
    };

    return { deps, userDirectory, workspacePersistence, idGenerator, clock, baseCommand };
  }

  it('creates workspace and active owner membership with normalized values and immutable timestamps', async () => {
    const { deps, workspacePersistence, baseCommand } = setupTestDeps();

    const result = await createWorkspace(baseCommand, deps);

    expect(result.workspace).toEqual({
      id: validWorkspaceId,
      name: 'Acme Marketing',
      slug: 'acme-marketing-01',
      timezone: 'Asia/Ho_Chi_Minh',
      brandVoice: 'Punchy and direct',
      defaultDisclosure: '#affiliate',
      aiEnabled: true,
      status: 'active',
      createdAt: fixedDateIso,
      updatedAt: fixedDateIso,
      version: 1,
    });

    expect(result.membership).toEqual({
      id: validMembershipId,
      workspaceId: validWorkspaceId,
      userId: validUserId,
      role: 'owner',
      status: 'active',
      invitedByUserId: null,
      joinedAt: fixedDateIso,
      createdAt: fixedDateIso,
      updatedAt: fixedDateIso,
      version: 1,
    });

    expect(typeof result.workspace.createdAt).toBe('string');
    expect(typeof result.workspace.updatedAt).toBe('string');
    expect(typeof result.membership.joinedAt).toBe('string');
    expect(typeof result.membership.createdAt).toBe('string');
    expect(typeof result.membership.updatedAt).toBe('string');

    // Values match expected instant
    expect(result.workspace.createdAt).toBe(fixedDateIso);
    expect(result.workspace.updatedAt).toBe(result.workspace.createdAt);
    expect(result.membership.joinedAt).toBe(result.workspace.createdAt);

    expect(workspacePersistence.createCalls).toHaveLength(1);
    expect(workspacePersistence.createCalls[0]?.workspace.slug).toBe('acme-marketing-01');
    expect(workspacePersistence.createCalls[0]?.membership.role).toBe('owner');
    expect(workspacePersistence.createCalls[0]?.membership.joinedAt).toBe(fixedDateIso);
  });

  it('proves snapshot timestamp values are immutable and mutation on clock date does not affect snapshot', async () => {
    const { deps, clock, baseCommand } = setupTestDeps();

    const result = await createWorkspace(baseCommand, deps);

    // Mutate the clock date that was passed into the fake
    clock.fixedTime.setFullYear(2000);

    // Snapshot timestamp must remain unchanged
    expect(result.workspace.createdAt).toBe(fixedDateIso);
    expect(result.workspace.updatedAt).toBe(fixedDateIso);
    expect(result.membership.joinedAt).toBe(fixedDateIso);

    // Attempted modification of snapshot properties is prevented by Object.freeze
    expect(Object.isFrozen(result.workspace)).toBe(true);
    expect(Object.isFrozen(result.membership)).toBe(true);
    expect(() => {
      (result.workspace as unknown as Record<string, unknown>).createdAt =
        '2000-01-01T00:00:00.000Z';
    }).toThrow();
  });

  it('fails cleanly before persistence when clock returns an invalid Date', async () => {
    const { deps, clock, workspacePersistence, userDirectory, baseCommand } = setupTestDeps();
    clock.fixedTime = new Date('invalid');

    await expect(createWorkspace(baseCommand, deps)).rejects.toThrow(ValidationError);
    expect(workspacePersistence.createCalls).toHaveLength(0);
    // User directory was checked, but persistence was never reached
    expect(userDirectory.calls).toHaveLength(1);
  });

  it('converts blank optional fields to null and defaults aiEnabled to false', async () => {
    const { deps, baseCommand } = setupTestDeps();

    const result = await createWorkspace(
      {
        ...baseCommand,
        brandVoice: '   ',
        defaultDisclosure: undefined,
        aiEnabled: undefined,
      },
      deps,
    );

    expect(result.workspace.brandVoice).toBeNull();
    expect(result.workspace.defaultDisclosure).toBeNull();
    expect(result.workspace.aiEnabled).toBe(false);
  });

  it('accepts explicit boolean false for aiEnabled', async () => {
    const { deps, baseCommand } = setupTestDeps();

    const result = await createWorkspace(
      {
        ...baseCommand,
        aiEnabled: false,
      },
      deps,
    );

    expect(result.workspace.aiEnabled).toBe(false);
  });

  it('accepts explicit boolean true for aiEnabled', async () => {
    const { deps, baseCommand } = setupTestDeps();

    const result = await createWorkspace(
      {
        ...baseCommand,
        aiEnabled: true,
      },
      deps,
    );

    expect(result.workspace.aiEnabled).toBe(true);
  });

  describe('Strict aiEnabled validation (Finding 2)', () => {
    const invalidAiEnabledValues: Array<[string, unknown]> = [
      ['null', null],
      ['empty string', ''],
      ['string "false"', 'false'],
      ['string "true"', 'true'],
      ['number 0', 0],
      ['number 1', 1],
      ['negative number -1', -1],
      ['bigint 0n', 0n],
      ['empty object', {}],
      ['empty array', []],
      ['array with boolean', [true]],
      ['symbol', Symbol('ai')],
      ['function', () => true],
    ];

    it.each(invalidAiEnabledValues)(
      'rejects non-boolean aiEnabled (%s) before any dependency call',
      async (_, invalidValue) => {
        const { deps, userDirectory, workspacePersistence, idGenerator, baseCommand } =
          setupTestDeps();

        const invalidCommand = {
          ...baseCommand,
          aiEnabled: invalidValue as unknown as boolean,
        };

        const error = await createWorkspace(invalidCommand, deps).catch((e) => e);

        expect(error).toBeInstanceOf(ValidationError);
        expect((error as ValidationError).field).toBe('aiEnabled');

        // Zero dependency calls
        expect(userDirectory.calls).toHaveLength(0);
        expect(workspacePersistence.createCalls).toHaveLength(0);
        expect(idGenerator.generateWorkspaceCalls).toBe(0);
        expect(idGenerator.generateMembershipCalls).toBe(0);
      },
    );
  });

  it('rejects missing user before calling persistence port', async () => {
    const { deps, userDirectory, workspacePersistence, baseCommand } = setupTestDeps();
    userDirectory.users.clear();

    await expect(createWorkspace(baseCommand, deps)).rejects.toThrow(UserNotFoundError);
    expect(workspacePersistence.createCalls).toHaveLength(0);
  });

  it('rejects disabled user with typed InactiveUserError before persistence', async () => {
    const { deps, userDirectory, workspacePersistence, baseCommand } = setupTestDeps();
    const disabledUser = { ...userDirectory.users.get(validUserId)!, status: 'disabled' as const };
    userDirectory.users.set(validUserId, disabledUser);

    await expect(createWorkspace(baseCommand, deps)).rejects.toThrow(InactiveUserError);
    expect(workspacePersistence.createCalls).toHaveLength(0);
  });

  it('rejects deletion_pending user with typed InactiveUserError before persistence', async () => {
    const { deps, userDirectory, workspacePersistence, baseCommand } = setupTestDeps();
    const pendingUser = {
      ...userDirectory.users.get(validUserId)!,
      status: 'deletion_pending' as const,
    };
    userDirectory.users.set(validUserId, pendingUser);

    await expect(createWorkspace(baseCommand, deps)).rejects.toThrow(InactiveUserError);
    expect(workspacePersistence.createCalls).toHaveLength(0);
  });

  it('rejects invalid inputs with typed ValidationError before user resolution', async () => {
    const { deps, userDirectory, baseCommand } = setupTestDeps();

    await expect(createWorkspace({ ...baseCommand, name: '  ' }, deps)).rejects.toThrow(
      ValidationError,
    );
    await expect(
      createWorkspace({ ...baseCommand, slug: 'invalid--slug--format' }, deps),
    ).rejects.toThrow(ValidationError);
    await expect(createWorkspace({ ...baseCommand, timezone: 'EST' }, deps)).rejects.toThrow(
      ValidationError,
    );

    expect(userDirectory.calls).toHaveLength(0);
  });

  it('propagates SlugConflictError from persistence without mutating it', async () => {
    const { deps, workspacePersistence, baseCommand } = setupTestDeps();
    workspacePersistence.slugConflictOn = 'acme-marketing-01';

    await expect(createWorkspace(baseCommand, deps)).rejects.toThrow(SlugConflictError);
  });

  it('generates an idempotency record and allowlisted audit event for workspace creation', async () => {
    const { deps, baseCommand } = setupTestDeps();
    const keyHash = new Uint8Array(32).fill(1);
    const requestHash = new Uint8Array(32).fill(2);

    const result = await createWorkspace(
      {
        ...baseCommand,
        idempotency: { keyHash, requestHash },
        auditContext: {
          ipHash: 'a'.repeat(64),
          userAgentSummary: 'Mozilla/5.0',
          correlationId: '0192b012-3456-789a-8bcd-ef0123456799',
        },
      },
      deps,
    );

    expect(result.idempotencyRecord).toBeDefined();
    expect(result.idempotencyRecord?.keyHash).toEqual(keyHash);
    expect(result.idempotencyRecord?.requestHash).toEqual(requestHash);
    expect(result.idempotencyRecord?.routeKey).toBe('POST /api/v1/workspaces');
    expect(result.idempotencyRecord?.statusCode).toBe(201);
    expect(result.idempotencyRecord?.resourceType).toBe('workspace');
    expect(result.idempotencyRecord?.resourceId).toBe(result.workspace.id);

    expect(result.auditEvent).toBeDefined();
    expect(result.auditEvent?.action).toBe('workspace.created');
    expect(result.auditEvent?.resourceType).toBe('workspace');
    expect(result.auditEvent?.resourceId).toBe(result.workspace.id);
    expect(result.auditEvent?.result).toBe('succeeded');
    expect(result.auditEvent?.changes.status).toEqual({ before: null, after: 'active' });
    expect(result.auditEvent?.changes.name).toEqual({
      before: null,
      after: result.workspace.name,
    });
    expect(result.auditEvent?.changes.slug).toEqual({
      before: null,
      after: result.workspace.slug,
    });
    expect(result.auditEvent?.changes.timezone).toEqual({
      before: null,
      after: result.workspace.timezone,
    });
  });

  it('rejects command with missing idempotency with ValidationError', async () => {
    const { deps, baseCommand } = setupTestDeps();
    const commandWithoutIdempotency = { ...baseCommand } as Record<string, unknown>;
    delete commandWithoutIdempotency['idempotency'];

    await expect(
      createWorkspace(commandWithoutIdempotency as unknown as CreateWorkspaceCommand, deps),
    ).rejects.toThrow(ValidationError);
  });

  it('rejects command.idempotency with getter property on keyHash without invoking the getter', async () => {
    const { deps, baseCommand } = setupTestDeps();
    let getterCalled = false;
    const hostileIdempotency = {};
    Object.defineProperty(hostileIdempotency, 'keyHash', {
      get() {
        getterCalled = true;
        return new Uint8Array(32);
      },
      enumerable: true,
      configurable: true,
    });
    Object.defineProperty(hostileIdempotency, 'requestHash', {
      value: new Uint8Array(32),
      enumerable: true,
      writable: true,
      configurable: true,
    });

    const err = await createWorkspace(
      {
        ...baseCommand,
        idempotency: hostileIdempotency as unknown as CreateWorkspaceIdempotencyInput,
      },
      deps,
    ).catch((e) => e);

    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).field).toBe('idempotency');
    expect(getterCalled).toBe(false);
  });

  it('rejects command.idempotency with getter property on requestHash without invoking the getter', async () => {
    const { deps, baseCommand } = setupTestDeps();
    let getterCalled = false;
    const hostileIdempotency = {
      keyHash: new Uint8Array(32),
    };
    Object.defineProperty(hostileIdempotency, 'requestHash', {
      get() {
        getterCalled = true;
        return new Uint8Array(32);
      },
      enumerable: true,
      configurable: true,
    });

    const err = await createWorkspace(
      {
        ...baseCommand,
        idempotency: hostileIdempotency as unknown as CreateWorkspaceIdempotencyInput,
      },
      deps,
    ).catch((e) => e);

    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).field).toBe('idempotency');
    expect(getterCalled).toBe(false);
  });

  it('rejects Proxy objects for command.idempotency and for buffer hashes', async () => {
    const { deps, baseCommand } = setupTestDeps();

    // Proxy as idempotency container
    const proxyContainer = new Proxy(
      { keyHash: new Uint8Array(32), requestHash: new Uint8Array(32) },
      {},
    );
    await expect(
      createWorkspace({ ...baseCommand, idempotency: proxyContainer }, deps),
    ).rejects.toThrow(ValidationError);

    // Proxy as keyHash
    const proxyKeyHash = new Proxy(new Uint8Array(32), {});
    await expect(
      createWorkspace(
        {
          ...baseCommand,
          idempotency: {
            keyHash: proxyKeyHash as unknown as Uint8Array,
            requestHash: new Uint8Array(32),
          },
        },
        deps,
      ),
    ).rejects.toThrow(ValidationError);
  });

  it('rejects idempotency with extra properties or prototype extensions', async () => {
    const { deps, baseCommand } = setupTestDeps();

    // Extra property
    const extraProps = {
      keyHash: new Uint8Array(32),
      requestHash: new Uint8Array(32),
      extra: 'malicious',
    };
    await expect(
      createWorkspace(
        {
          ...baseCommand,
          idempotency: extraProps as unknown as CreateWorkspaceIdempotencyInput,
        },
        deps,
      ),
    ).rejects.toThrow(ValidationError);

    // Custom prototype
    const customProto = Object.create({ inherited: true });
    customProto.keyHash = new Uint8Array(32);
    customProto.requestHash = new Uint8Array(32);
    await expect(
      createWorkspace({ ...baseCommand, idempotency: customProto }, deps),
    ).rejects.toThrow(ValidationError);
  });

  it('defensively clones hashes so caller buffer mutation cannot alter persisted records', async () => {
    const { deps, workspacePersistence, baseCommand } = setupTestDeps();
    const callerKeyHash = new Uint8Array(32).fill(7);
    const callerReqHash = new Uint8Array(32).fill(8);

    const resultPromise = createWorkspace(
      { ...baseCommand, idempotency: { keyHash: callerKeyHash, requestHash: callerReqHash } },
      deps,
    );

    // Immediately mutate caller buffers
    callerKeyHash[0] = 255;
    callerReqHash[0] = 255;

    const result = await resultPromise;

    // Persisted call must receive cloned buffers with original values
    const persistedCall = workspacePersistence.createCalls[0];
    expect(persistedCall).toBeDefined();
    expect(persistedCall!.idempotencyRecord.keyHash[0]).toBe(7);
    expect(persistedCall!.idempotencyRecord.requestHash[0]).toBe(8);
    expect(result.idempotencyRecord.keyHash[0]).toBe(7);
    expect(result.idempotencyRecord.requestHash[0]).toBe(8);
  });

  it('returns auditEvent: null when cached replay is returned by persistence', async () => {
    const { deps, workspacePersistence, baseCommand } = setupTestDeps();
    workspacePersistence.createWorkspaceWithOwner = async (params) => {
      return {
        workspace: params.workspace,
        membership: params.membership,
        idempotencyRecord: params.idempotencyRecord,
        auditEvent: null,
        cached: true,
      };
    };

    const result = await createWorkspace(baseCommand, deps);
    expect(result.cached).toBe(true);
    expect(result.auditEvent).toBeNull();
  });

  it('MEDIUM-1: ensures ipHash is always null and sanitizes hostile user agent', async () => {
    const { deps, baseCommand } = setupTestDeps();
    const result = await createWorkspace(
      {
        ...baseCommand,
        auditContext: {
          ipHash: 'attempted-raw-ip-hash',
          userAgentSummary: 'Mozilla/5.0\0\r\n\x1b[31mEvil\x1b[0m\tAgent\u200B',
        },
      },
      deps,
    );

    // ipHash must be null
    expect(result.auditEvent?.ipHash).toBeNull();
    // userAgentSummary must be stripped of control chars, escape sequences, null bytes
    expect(result.auditEvent?.userAgentSummary).toBe('Mozilla/5.0[31mEvil[0mAgent');
  });
});
