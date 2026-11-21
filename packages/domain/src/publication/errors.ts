export class PublicationDomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PublicationDomainError';
  }
}

export class PublicationStateConflictError extends PublicationDomainError {
  readonly currentStatus: string;
  readonly attemptedAction: string;

  constructor(currentStatus: string, attemptedAction: string, detail?: string) {
    super(
      detail ??
        `Cannot perform '${attemptedAction}' when publication is in '${currentStatus}' status`,
    );
    this.name = 'PublicationStateConflictError';
    this.currentStatus = currentStatus;
    this.attemptedAction = attemptedAction;
  }
}

export class PublicationScheduleInvalidError extends PublicationDomainError {
  readonly reasonCode: string;

  constructor(reasonCode: string, message: string) {
    super(message);
    this.name = 'PublicationScheduleInvalidError';
    this.reasonCode = reasonCode;
  }
}

export class PublicationDriftError extends PublicationDomainError {
  readonly driftField: string;

  constructor(driftField: string, message: string) {
    super(message);
    this.name = 'PublicationDriftError';
    this.driftField = driftField;
  }
}

export class PublicationPreviewMismatchError extends PublicationDomainError {
  readonly clientPreviewHash: string;
  readonly serverPreviewHash: string;

  constructor(clientPreviewHash: string, serverPreviewHash: string) {
    super(
      `Client-supplied preview hash ${clientPreviewHash} does not match server-rendered preview hash ${serverPreviewHash}`,
    );
    this.name = 'PublicationPreviewMismatchError';
    this.clientPreviewHash = clientPreviewHash;
    this.serverPreviewHash = serverPreviewHash;
  }
}

export class PublicationGatedError extends PublicationDomainError {
  readonly gateReason: string;

  constructor(gateReason: string, message: string) {
    super(message);
    this.name = 'PublicationGatedError';
    this.gateReason = gateReason;
  }
}

export class PublicationFenceLostError extends PublicationDomainError {
  readonly publicationId: string;

  constructor(publicationId: string, message?: string) {
    super(
      message ??
        `Execution lease fence lost for publication ${publicationId}; another worker or recovery handled it`,
    );
    this.name = 'PublicationFenceLostError';
    this.publicationId = publicationId;
  }
}

export class PublicationNotFoundError extends PublicationDomainError {
  readonly publicationId: string;

  constructor(publicationId: string) {
    super(`Publication ${publicationId} not found`);
    this.name = 'PublicationNotFoundError';
    this.publicationId = publicationId;
  }
}

export class PublicationApprovalSnapshotNotFoundError extends PublicationDomainError {
  readonly snapshotId: string;

  constructor(snapshotId: string) {
    super(`Publication approval snapshot ${snapshotId} not found`);
    this.name = 'PublicationApprovalSnapshotNotFoundError';
    this.snapshotId = snapshotId;
  }
}
