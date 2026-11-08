import { DomainValidationError } from '../errors.js';
import {
  isValidUuid,
  sanitizeBoundedText,
  validateEvidenceReferencesArray,
  type DomainEvidenceReference,
} from './artifact-validation-common.js';

export interface VideoEpisodePlan {
  readonly episodeNumber: 1 | 2 | 3 | 4 | 5;
  readonly title: string;
  readonly purpose: string;
  readonly hook: string;
  readonly narrativeRole: string;
  readonly visualDirection: string;
  readonly callToActionDirection: string;
  readonly evidenceRefs: readonly string[];
}

export interface VideoSeriesCreativeDirection {
  readonly visualTone: string;
  readonly audioTone: string;
  readonly pacing: string;
}

export interface VideoSeriesPlan {
  readonly schemaVersion: 1;
  readonly seriesTitle: string;
  readonly seriesNarrativeArc: string;
  readonly episodes: readonly [
    VideoEpisodePlan,
    VideoEpisodePlan,
    VideoEpisodePlan,
    VideoEpisodePlan,
    VideoEpisodePlan,
  ];
  readonly creativeDirection: VideoSeriesCreativeDirection;
  readonly evidenceReferences: readonly DomainEvidenceReference[];
}

function validateRefIds(raw: unknown, prefix: string): readonly string[] {
  if (!Array.isArray(raw)) {
    throw new DomainValidationError(`${prefix} must be an array of IDs`, prefix);
  }
  const result: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const val = raw[i];
    if (typeof val !== 'string' || !isValidUuid(val)) {
      throw new DomainValidationError(
        `${prefix}[${i}] must be a valid UUID string`,
        `${prefix}[${i}]`,
      );
    }
    result.push(val.toLowerCase());
  }
  return Object.freeze([...new Set(result)]);
}

export function validateVideoSeriesPlan(raw: unknown): VideoSeriesPlan {
  if (typeof raw !== 'object' || raw === null) {
    throw new DomainValidationError('Video series plan must be an object', 'plan');
  }
  const obj = raw as Record<string, unknown>;

  if (obj.schemaVersion !== 1) {
    throw new DomainValidationError('schemaVersion must be 1', 'schemaVersion');
  }

  const seriesTitle = sanitizeBoundedText(obj.seriesTitle, 'seriesTitle', 1, 256);
  const seriesNarrativeArc = sanitizeBoundedText(
    obj.seriesNarrativeArc,
    'seriesNarrativeArc',
    1,
    2000,
  );

  // Validate exactly 5 episodes
  if (!Array.isArray(obj.episodes) || obj.episodes.length !== 5) {
    throw new DomainValidationError('episodes must contain exactly 5 video ideas', 'episodes');
  }

  const episodes: VideoEpisodePlan[] = [];
  for (let i = 0; i < 5; i++) {
    const epNum = (i + 1) as 1 | 2 | 3 | 4 | 5;
    const ep = obj.episodes[i];
    if (typeof ep !== 'object' || ep === null) {
      throw new DomainValidationError(`episodes[${i}] must be an object`, `episodes[${i}]`);
    }
    const epObj = ep as Record<string, unknown>;
    if (epObj.episodeNumber !== epNum) {
      throw new DomainValidationError(
        `episodes[${i}].episodeNumber must be ${epNum}`,
        `episodes[${i}].episodeNumber`,
      );
    }

    const title = sanitizeBoundedText(epObj.title, `episodes[${i}].title`, 1, 256);
    const purpose = sanitizeBoundedText(epObj.purpose, `episodes[${i}].purpose`, 1, 500);
    const hook = sanitizeBoundedText(epObj.hook, `episodes[${i}].hook`, 1, 500);
    const narrativeRole = sanitizeBoundedText(
      epObj.narrativeRole,
      `episodes[${i}].narrativeRole`,
      1,
      500,
    );
    const visualDirection = sanitizeBoundedText(
      epObj.visualDirection,
      `episodes[${i}].visualDirection`,
      1,
      1000,
    );
    const callToActionDirection = sanitizeBoundedText(
      epObj.callToActionDirection,
      `episodes[${i}].callToActionDirection`,
      1,
      500,
    );
    const evidenceRefs = validateRefIds(epObj.evidenceRefs, `episodes[${i}].evidenceRefs`);

    episodes.push(
      Object.freeze({
        episodeNumber: epNum,
        title,
        purpose,
        hook,
        narrativeRole,
        visualDirection,
        callToActionDirection,
        evidenceRefs,
      }),
    );
  }

  // Validate creativeDirection
  if (typeof obj.creativeDirection !== 'object' || obj.creativeDirection === null) {
    throw new DomainValidationError('creativeDirection must be an object', 'creativeDirection');
  }
  const cdObj = obj.creativeDirection as Record<string, unknown>;
  const visualTone = sanitizeBoundedText(cdObj.visualTone, 'creativeDirection.visualTone', 1, 500);
  const audioTone = sanitizeBoundedText(cdObj.audioTone, 'creativeDirection.audioTone', 1, 500);
  const pacing = sanitizeBoundedText(cdObj.pacing, 'creativeDirection.pacing', 1, 500);

  const creativeDirection = Object.freeze({
    visualTone,
    audioTone,
    pacing,
  });

  const evidenceReferences = validateEvidenceReferencesArray(
    obj.evidenceReferences,
    'evidenceReferences',
    1,
    50,
  );

  return Object.freeze({
    schemaVersion: 1,
    seriesTitle,
    seriesNarrativeArc,
    episodes: Object.freeze(episodes) as unknown as readonly [
      VideoEpisodePlan,
      VideoEpisodePlan,
      VideoEpisodePlan,
      VideoEpisodePlan,
      VideoEpisodePlan,
    ],
    creativeDirection,
    evidenceReferences,
  });
}
