import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactElement,
} from 'react';
import { slugify } from '../lib/slugify.js';
import type { CreateWorkspacePayload } from '../lib/api-client.js';
import {
  validateWorkspaceForm,
  type WorkspaceValidationErrors,
} from '../lib/workspace-form-validation.js';
import { WorkspaceSubmissionController } from '../lib/workspace-submission-controller.js';
import { WorkspaceFormFields } from './workspace-form-fields.js';
import {
  resolveClientBrowserTimezone,
  shouldUpdateBrowserTimezone,
} from '../lib/timezone-helper.js';
import { useEscapeKey } from '../lib/use-escape-key.js';

interface CreateWorkspaceDialogProps {
  readonly onSave: (payload: CreateWorkspacePayload, idempotencyKey: string) => Promise<void>;
  readonly onCancel?: () => void;
  readonly isInitialOnboarding?: boolean;
}

export function CreateWorkspaceDialog({
  onSave,
  onCancel,
  isInitialOnboarding = false,
}: CreateWorkspaceDialogProps): ReactElement {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [timezone, setTimezone] = useState('UTC');
  const [timezoneManuallyEdited, setTimezoneManuallyEdited] = useState(false);
  const [brandVoice, setBrandVoice] = useState('');
  const [defaultDisclosure, setDefaultDisclosure] = useState('');
  const [aiEnabled, setAiEnabled] = useState(true);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<WorkspaceValidationErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const controllerRef = useRef<WorkspaceSubmissionController>(new WorkspaceSubmissionController());
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isInitialOnboarding) nameInputRef.current?.focus();
  }, [isInitialOnboarding]);

  useEffect(() => {
    const detected = resolveClientBrowserTimezone();
    if (shouldUpdateBrowserTimezone(timezoneManuallyEdited, timezone, detected) && detected) {
      setTimezone(detected);
    }
  }, [timezoneManuallyEdited, timezone]);

  useEscapeKey(onCancel, isSubmitting, !isInitialOnboarding);

  const handleNameChange = (e: ChangeEvent<HTMLInputElement>) => {
    const val = e.currentTarget.value;
    setName(val);
    if (!slugManuallyEdited) setSlug(slugify(val));
    if (fieldErrors.name && val.trim().length > 0) {
      setFieldErrors(({ name: _, ...rest }) => rest);
    }
  };

  const handleSlugChange = (e: ChangeEvent<HTMLInputElement>) => {
    setSlugManuallyEdited(true);
    const val = e.currentTarget.value;
    setSlug(val);
    if (fieldErrors.slug && val.trim().length >= 2) {
      setFieldErrors(({ slug: _, ...rest }) => rest);
    }
  };

  const handleTimezoneChange = (val: string) => {
    setTimezoneManuallyEdited(true);
    setTimezone(val);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (controllerRef.current.getIsSubmitting()) return;
    setErrorMsg(null);

    const errors = validateWorkspaceForm(name, slug);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setIsSubmitting(true);
    const res = await controllerRef.current.submit(
      {
        name: name.trim(),
        slug: slug.trim(),
        timezone: timezone.trim(),
        brandVoice: brandVoice.trim() || null,
        defaultDisclosure: defaultDisclosure.trim() || null,
        aiEnabled,
      },
      onSave,
    );

    setIsSubmitting(false);
    if (!res.success && res.error) {
      setErrorMsg(res.error);
    }
  };

  const titleId = isInitialOnboarding ? 'onboarding-title' : 'modal-dialog-title';
  const subtitleId = isInitialOnboarding ? 'onboarding-desc' : 'modal-dialog-desc';

  const content = (
    <>
      <header className="dialog-header">
        <h2 id={titleId} className="dialog-title">
          {isInitialOnboarding ? 'Create Your First Workspace' : 'Create New Workspace'}
        </h2>
        <p id={subtitleId} className="dialog-subtitle">
          Workspaces isolate catalogs, brands, and editorial publications.
        </p>
      </header>
      {errorMsg && (
        <div role="alert" className="error-banner">
          {errorMsg}
        </div>
      )}
      <form onSubmit={handleSubmit} className="workspace-form" noValidate>
        <WorkspaceFormFields
          values={{ name, slug, timezone, brandVoice, defaultDisclosure, aiEnabled }}
          fieldErrors={fieldErrors}
          nameInputRef={nameInputRef}
          onNameChange={handleNameChange}
          onSlugChange={handleSlugChange}
          onTimezoneChange={handleTimezoneChange}
          onBrandVoiceChange={setBrandVoice}
          onDisclosureChange={setDefaultDisclosure}
          onAiEnabledChange={setAiEnabled}
        />
        <div className="form-actions">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={isSubmitting}
              className="btn-secondary"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={isSubmitting}
            className="btn-primary"
            aria-label="Create workspace"
          >
            {isSubmitting ? 'Creating...' : 'Create Workspace'}
          </button>
        </div>
      </form>
    </>
  );

  if (isInitialOnboarding) {
    return (
      <section className="onboarding-card" aria-labelledby={titleId} aria-describedby={subtitleId}>
        {content}
      </section>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={subtitleId}
      className="modal-card"
    >
      {content}
    </div>
  );
}
