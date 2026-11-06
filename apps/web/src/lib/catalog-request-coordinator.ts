export interface RequestHandle {
  readonly sequence: number;
  readonly signal: AbortSignal;
}

export class CatalogRequestCoordinator {
  private currentSequence = 0;
  private abortController: AbortController | null = null;

  public startRequest(): RequestHandle {
    if (this.abortController) {
      this.abortController.abort();
    }
    this.currentSequence += 1;
    this.abortController = new AbortController();
    return {
      sequence: this.currentSequence,
      signal: this.abortController.signal,
    };
  }

  public isCurrent(sequence: number): boolean {
    return this.currentSequence === sequence;
  }

  public invalidate(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.currentSequence += 1;
  }
}
