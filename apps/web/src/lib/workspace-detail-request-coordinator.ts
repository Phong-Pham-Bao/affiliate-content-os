export interface RequestHandle {
  readonly sequence: number;
  readonly signal: AbortSignal;
}

export class WorkspaceDetailRequestCoordinator {
  private currentSequence = 0;
  private activeController: AbortController | null = null;
  private currentWorkspaceId: string | null = null;

  public startRequest(workspaceId: string): RequestHandle {
    this.currentSequence += 1;
    this.currentWorkspaceId = workspaceId;
    if (this.activeController) {
      this.activeController.abort();
    }
    this.activeController = new AbortController();
    return {
      sequence: this.currentSequence,
      signal: this.activeController.signal,
    };
  }

  public isCurrent(sequence: number): boolean {
    return sequence === this.currentSequence;
  }

  public getCurrentWorkspaceId(): string | null {
    return this.currentWorkspaceId;
  }

  public getSequence(): number {
    return this.currentSequence;
  }

  public invalidate(): void {
    this.currentSequence += 1;
    this.currentWorkspaceId = null;
    if (this.activeController) {
      this.activeController.abort();
      this.activeController = null;
    }
  }
}
