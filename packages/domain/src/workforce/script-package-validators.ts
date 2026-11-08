import { DomainValidationError } from '../errors.js';
import { sanitizeBoundedText } from './artifact-validation-common.js';
import type {
  ScriptCallToAction,
  ScriptDisclosure,
  ScriptHook,
  ScriptOverlay,
  ScriptScene,
  ScriptShot,
  ScriptVariant,
} from './script-package-types.js';

export function validateTimeRange(
  raw: unknown,
  path: string,
): { readonly start: number; readonly end: number } {
  if (typeof raw !== 'object' || raw === null) {
    throw new DomainValidationError(`${path} must be an object with start and end`, path);
  }
  const obj = raw as Record<string, unknown>;
  const start = Number(obj.start);
  const end = Number(obj.end);
  if (!Number.isFinite(start) || start < 0) {
    throw new DomainValidationError(`${path}.start must be a non-negative number`, `${path}.start`);
  }
  if (!Number.isFinite(end) || end < start) {
    throw new DomainValidationError(`${path}.end must be >= start`, `${path}.end`);
  }
  return Object.freeze({ start, end });
}

export function validateScenes(raw: unknown, path: string): readonly ScriptScene[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 10) {
    throw new DomainValidationError(`${path} must contain 1 to 10 scenes`, path);
  }
  return Object.freeze(
    raw.map((item, idx) => {
      const p = `${path}[${idx}]`;
      if (typeof item !== 'object' || item === null) {
        throw new DomainValidationError(`${p} must be an object`, p);
      }
      const s = item as Record<string, unknown>;
      return Object.freeze({
        sceneNumber: idx + 1,
        timeRangeSeconds: validateTimeRange(s.timeRangeSeconds, `${p}.timeRangeSeconds`),
        visualDescription: sanitizeBoundedText(
          s.visualDescription,
          `${p}.visualDescription`,
          1,
          1000,
        ),
        spokenText: sanitizeBoundedText(s.spokenText, `${p}.spokenText`, 1, 1000),
        audioCue: s.audioCue ? sanitizeBoundedText(s.audioCue, `${p}.audioCue`, 1, 200) : null,
      });
    }),
  );
}

export function validateOverlays(raw: unknown, path: string): readonly ScriptOverlay[] {
  if (!Array.isArray(raw) || raw.length > 10) {
    throw new DomainValidationError(`${path} must be an array of at most 10 overlays`, path);
  }
  const allowed = new Set(['top', 'middle', 'bottom', 'lower_third', 'sticker']);
  return Object.freeze(
    raw.map((item, idx) => {
      const p = `${path}[${idx}]`;
      if (typeof item !== 'object' || item === null) {
        throw new DomainValidationError(`${p} must be an object`, p);
      }
      const o = item as Record<string, unknown>;
      const placement = String(o.placement ?? '').trim();
      if (!allowed.has(placement)) {
        throw new DomainValidationError(`${p}.placement is invalid`, `${p}.placement`);
      }
      return Object.freeze({
        text: sanitizeBoundedText(o.text, `${p}.text`, 1, 200),
        timeRangeSeconds: validateTimeRange(o.timeRangeSeconds, `${p}.timeRangeSeconds`),
        placement: placement as ScriptOverlay['placement'],
      });
    }),
  );
}

export function validateShots(raw: unknown, path: string): readonly ScriptShot[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 15) {
    throw new DomainValidationError(`${path} must contain 1 to 15 shots`, path);
  }
  return Object.freeze(
    raw.map((item, idx) => {
      const p = `${path}[${idx}]`;
      if (typeof item !== 'object' || item === null) {
        throw new DomainValidationError(`${p} must be an object`, p);
      }
      const s = item as Record<string, unknown>;
      const dur = Number(s.durationSeconds);
      if (!Number.isFinite(dur) || dur < 0.5 || dur > 60) {
        throw new DomainValidationError(
          `${p}.durationSeconds must be between 0.5 and 60`,
          `${p}.durationSeconds`,
        );
      }
      const rawProps = Array.isArray(s.props) ? s.props : [];
      const props = rawProps
        .slice(0, 10)
        .map((pr, pidx) => sanitizeBoundedText(pr, `${p}.props[${pidx}]`, 1, 100));
      return Object.freeze({
        shotNumber: idx + 1,
        durationSeconds: dur,
        description: sanitizeBoundedText(s.description, `${p}.description`, 1, 500),
        cameraAngle: sanitizeBoundedText(s.cameraAngle, `${p}.cameraAngle`, 1, 100),
        framing: sanitizeBoundedText(s.framing, `${p}.framing`, 1, 100),
        movement: sanitizeBoundedText(s.movement, `${p}.movement`, 1, 100),
        props: Object.freeze(props),
      });
    }),
  );
}

export function validateHook(raw: unknown, path: string): ScriptHook {
  if (typeof raw !== 'object' || raw === null) {
    throw new DomainValidationError(`${path} must be an object`, path);
  }
  const h = raw as Record<string, unknown>;
  return Object.freeze({
    spokenHook: sanitizeBoundedText(h.spokenHook, `${path}.spokenHook`, 1, 500),
    visualHook: sanitizeBoundedText(h.visualHook, `${path}.visualHook`, 1, 500),
  });
}

export function validateCta(raw: unknown, path: string): ScriptCallToAction {
  if (typeof raw !== 'object' || raw === null) {
    throw new DomainValidationError(`${path} must be an object`, path);
  }
  const c = raw as Record<string, unknown>;
  return Object.freeze({
    text: sanitizeBoundedText(c.text, `${path}.text`, 1, 300),
    visualDirection: sanitizeBoundedText(c.visualDirection, `${path}.visualDirection`, 1, 500),
  });
}

export function validateDisclosure(raw: unknown, path: string): ScriptDisclosure {
  if (typeof raw !== 'object' || raw === null) {
    throw new DomainValidationError(`${path} must be an object`, path);
  }
  const d = raw as Record<string, unknown>;
  return Object.freeze({
    placement: sanitizeBoundedText(d.placement, `${path}.placement`, 1, 100),
    text: sanitizeBoundedText(d.text, `${path}.text`, 1, 300),
  });
}

export function validateVariants(raw: unknown, path: string): readonly ScriptVariant[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 3) {
    throw new DomainValidationError(`${path} must contain 1 to 3 variants`, path);
  }
  return Object.freeze(
    raw.map((v, idx) => {
      const p = `${path}[${idx}]`;
      if (typeof v !== 'object' || v === null) {
        throw new DomainValidationError(`${p} must be an object`, p);
      }
      const vObj = v as Record<string, unknown>;
      const vNum = (idx + 1) as 1 | 2 | 3;
      const rawHypotheses = Array.isArray(vObj.creativeHypotheses) ? vObj.creativeHypotheses : [];
      const creativeHypotheses = rawHypotheses
        .slice(0, 10)
        .map((h, hidx) => sanitizeBoundedText(h, `${p}.creativeHypotheses[${hidx}]`, 1, 500));
      return Object.freeze({
        variantNumber: vNum,
        label: vObj.label
          ? sanitizeBoundedText(vObj.label, `${p}.label`, 1, 100)
          : `Biến thể ${vNum}`,
        hook: validateHook(vObj.hook, `${p}.hook`),
        voiceOver: sanitizeBoundedText(vObj.voiceOver, `${p}.voiceOver`, 1, 4000),
        scenes: validateScenes(vObj.scenes, `${p}.scenes`),
        callToAction: validateCta(vObj.callToAction, `${p}.callToAction`),
        creativeHypotheses: Object.freeze(creativeHypotheses),
      });
    }),
  );
}
