import type { DomainEvidenceReference } from './artifact-validation-common.js';

export interface ScriptScene {
  readonly sceneNumber: number;
  readonly timeRangeSeconds: {
    readonly start: number;
    readonly end: number;
  };
  readonly visualDescription: string;
  readonly spokenText: string;
  readonly audioCue?: string | null | undefined;
}

export interface ScriptOverlay {
  readonly text: string;
  readonly timeRangeSeconds: {
    readonly start: number;
    readonly end: number;
  };
  readonly placement: 'top' | 'middle' | 'bottom' | 'lower_third' | 'sticker';
}

export interface ScriptShot {
  readonly shotNumber: number;
  readonly durationSeconds: number;
  readonly description: string;
  readonly cameraAngle: string;
  readonly framing: string;
  readonly movement: string;
  readonly props: readonly string[];
}

export interface ScriptHook {
  readonly spokenHook: string;
  readonly visualHook: string;
}

export interface ScriptCallToAction {
  readonly text: string;
  readonly visualDirection: string;
}

export interface ScriptDisclosure {
  readonly placement: string;
  readonly text: string;
}

export interface ScriptVariant {
  readonly variantNumber: 1 | 2 | 3;
  readonly label?: string | undefined;
  readonly hook: ScriptHook;
  readonly voiceOver: string;
  readonly scenes: readonly ScriptScene[];
  readonly callToAction: ScriptCallToAction;
  readonly creativeHypotheses?: readonly string[] | undefined;
}

export interface ScriptVideo {
  readonly videoNumber: 1 | 2 | 3 | 4 | 5;
  readonly title: string;
  readonly objective: string;
  readonly targetDurationSeconds: number;
  readonly hook: ScriptHook;
  readonly voiceOver: string;
  readonly scenes: readonly ScriptScene[];
  readonly onScreenOverlays: readonly ScriptOverlay[];
  readonly callToAction: ScriptCallToAction;
  readonly disclosure: ScriptDisclosure;
  readonly shotList: readonly ScriptShot[];
  readonly variants: readonly ScriptVariant[];
  readonly evidenceReferences: readonly DomainEvidenceReference[];
  readonly creativeHypotheses: readonly string[];
}

export interface ScriptPackage {
  readonly schemaVersion: 1;
  readonly seriesTitle: string;
  readonly targetAudienceSummary: string;
  readonly creativeDirectionSummary: string;
  readonly videos: readonly [ScriptVideo, ScriptVideo, ScriptVideo, ScriptVideo, ScriptVideo];
  readonly evidenceReferences: readonly DomainEvidenceReference[];
}

export interface SingleVideoScript {
  readonly schemaVersion: 1;
  readonly video: ScriptVideo;
}
