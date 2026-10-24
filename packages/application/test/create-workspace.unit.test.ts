import { describe, expect, it } from 'vitest';
import {
  parseMembershipId,
  parseUserId,
  parseWorkspaceId,
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
  type CreateWorkspaceWithOwnerParams,
  type CreateWorkspaceResult,
  type IdGeneratorPort,
  type UserDirectoryPort,
  type WorkspacePersistencePort,
} from '../src/index.js';

class FakeClock implements ClockPort {
  constructor(private readonly fixedTime: Date) {}
  public now(): Date {
    return new Date(this.fixedTime.getTime());
  }
}

class FakeIdGenerator implements IdGeneratorPort {
  constructor(
    private readonly workspaceId: WorkspaceId,
    private readonly membershipId: MembershipId,
    private readonly userId: UserId,
  ) {}
  public generateWorkspaceId(): WorkspaceId {
    return this.workspaceId;
  }
  public generateMembershipId(): MembershipId {
    return this.membershipId;
  }
  public generateUserId(): UserId {
    return this.userId;
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
  const fixedDate = new Date('2026-10-25T12:00:00.000Z');
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
      createdAt: new Date('2026-10-01T00:00:00Z'),
      updatedAt: new Date('2026-10-01T00:00:00Z'),
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
    };

    return { deps, userDirectory, workspacePersistence, baseCommand };
  }

  it('creates workspace and active owner membership with normalized values', async () => {
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
      createdAt: fixedDate,
      updatedAt: fixedDate,
      version: 1,
    });

    expect(result.membership).toEqual({
      id: validMembershipId,
      workspaceId: validWorkspaceId,
      userId: validUserId,
      role: 'owner',
      status: 'active',
      invitedByUserId: null,
      joinedAt: fixedDate,
      createdAt: fixedDate,
      updatedAt: fixedDate,
      version: 1,
    });

    expect(workspacePersistence.createCalls).toHaveLength(1);
    expect(workspacePersistence.createCalls[0]?.workspace.slug).toBe('acme-marketing-01');
    expect(workspacePersistence.createCalls[0]?.membership.role).toBe('owner');
    expect(workspacePersistence.createCalls[0]?.membership.joinedAt).toEqual(fixedDate);
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
});
