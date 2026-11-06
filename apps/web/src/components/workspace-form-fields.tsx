import type { ChangeEvent, ReactElement, RefObject } from 'react';

export const COMMON_TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Asia/Ho_Chi_Minh',
  'Australia/Sydney',
];

export interface WorkspaceFormValues {
  readonly name: string;
  readonly slug: string;
  readonly timezone: string;
  readonly brandVoice: string;
  readonly defaultDisclosure: string;
  readonly aiEnabled: boolean;
}

interface WorkspaceFormFieldsProps {
  readonly values: WorkspaceFormValues;
  readonly fieldErrors: { readonly name?: string; readonly slug?: string };
  readonly nameInputRef?: RefObject<HTMLInputElement | null>;
  readonly onNameChange: (e: ChangeEvent<HTMLInputElement>) => void;
  readonly onSlugChange: (e: ChangeEvent<HTMLInputElement>) => void;
  readonly onTimezoneChange: (val: string) => void;
  readonly onBrandVoiceChange: (val: string) => void;
  readonly onDisclosureChange: (val: string) => void;
  readonly onAiEnabledChange: (val: boolean) => void;
}

export function WorkspaceFormFields({
  values,
  fieldErrors,
  nameInputRef,
  onNameChange,
  onSlugChange,
  onTimezoneChange,
  onBrandVoiceChange,
  onDisclosureChange,
  onAiEnabledChange,
}: WorkspaceFormFieldsProps): ReactElement {
  return (
    <>
      <div className="form-group">
        <label htmlFor="ws-name">Workspace Name *</label>
        <input
          ref={nameInputRef}
          id="ws-name"
          type="text"
          required
          maxLength={100}
          value={values.name}
          onChange={onNameChange}
          aria-describedby={fieldErrors.name ? 'ws-name-error' : undefined}
          placeholder="e.g. Acme Media"
          className={fieldErrors.name ? 'input-error' : ''}
        />
        {fieldErrors.name && (
          <p id="ws-name-error" className="field-error">
            {fieldErrors.name}
          </p>
        )}
      </div>

      <div className="form-group">
        <label htmlFor="ws-slug">Slug (URL Identifier) *</label>
        <input
          id="ws-slug"
          type="text"
          required
          maxLength={64}
          value={values.slug}
          onChange={onSlugChange}
          aria-describedby={fieldErrors.slug ? 'ws-slug-error' : undefined}
          placeholder="e.g. acme-media"
          className={fieldErrors.slug ? 'input-error' : ''}
        />
        {fieldErrors.slug && (
          <p id="ws-slug-error" className="field-error">
            {fieldErrors.slug}
          </p>
        )}
      </div>

      <div className="form-group">
        <label htmlFor="ws-timezone">Timezone *</label>
        <select
          id="ws-timezone"
          value={values.timezone}
          onChange={(e) => onTimezoneChange(e.currentTarget.value)}
        >
          {Array.from(new Set([values.timezone, ...COMMON_TIMEZONES])).map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </select>
      </div>

      <div className="form-group">
        <label htmlFor="ws-brand-voice">Brand Voice (Optional)</label>
        <textarea
          id="ws-brand-voice"
          rows={2}
          maxLength={500}
          value={values.brandVoice}
          onChange={(e) => onBrandVoiceChange(e.currentTarget.value)}
          placeholder="e.g. Authoritative, direct, product-focused"
        />
      </div>

      <div className="form-group">
        <label htmlFor="ws-disclosure">Default Disclosure (Optional)</label>
        <input
          id="ws-disclosure"
          type="text"
          maxLength={255}
          value={values.defaultDisclosure}
          onChange={(e) => onDisclosureChange(e.currentTarget.value)}
          placeholder="e.g. We may earn an affiliate commission."
        />
      </div>

      <div className="form-checkbox">
        <label>
          <input
            type="checkbox"
            checked={values.aiEnabled}
            onChange={(e) => onAiEnabledChange(e.currentTarget.checked)}
          />
          <span>Enable AI Generation for this workspace</span>
        </label>
      </div>
    </>
  );
}
