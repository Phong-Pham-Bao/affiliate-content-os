'use client';

import type { ChangeEvent, ReactElement } from 'react';

interface ContentStudioManualEditorFieldsProps {
  readonly videoTitle: string;
  readonly videoObjective: string;
  readonly spokenHook: string;
  readonly visualHook: string;
  readonly voiceOver: string;
  readonly ctaText: string;
  readonly disclosureText: string;
  readonly note: string;
  readonly isSubmitting: boolean;
  readonly onChangeTitle: (e: ChangeEvent<HTMLInputElement>) => void;
  readonly onChangeObjective: (e: ChangeEvent<HTMLInputElement>) => void;
  readonly onChangeSpokenHook: (e: ChangeEvent<HTMLTextAreaElement>) => void;
  readonly onChangeVisualHook: (e: ChangeEvent<HTMLTextAreaElement>) => void;
  readonly onChangeVoiceOver: (e: ChangeEvent<HTMLTextAreaElement>) => void;
  readonly onChangeCta: (e: ChangeEvent<HTMLInputElement>) => void;
  readonly onChangeDisclosure: (e: ChangeEvent<HTMLInputElement>) => void;
  readonly onChangeNote: (e: ChangeEvent<HTMLInputElement>) => void;
}

export function ContentStudioManualEditorFields({
  videoTitle,
  videoObjective,
  spokenHook,
  visualHook,
  voiceOver,
  ctaText,
  disclosureText,
  note,
  isSubmitting,
  onChangeTitle,
  onChangeObjective,
  onChangeSpokenHook,
  onChangeVisualHook,
  onChangeVoiceOver,
  onChangeCta,
  onChangeDisclosure,
  onChangeNote,
}: ContentStudioManualEditorFieldsProps): ReactElement {
  return (
    <>
      <div className="row g-3 mb-3">
        <div className="col-12 col-md-8">
          <label htmlFor="edit-title" className="form-label text-sm font-weight-bold">
            Tiêu đề video
          </label>
          <input
            id="edit-title"
            type="text"
            className="form-control form-control-sm"
            value={videoTitle}
            onChange={onChangeTitle}
            required
            disabled={isSubmitting}
          />
        </div>
        <div className="col-12 col-md-4">
          <label htmlFor="edit-cta" className="form-label text-sm font-weight-bold">
            Lời kêu gọi (CTA)
          </label>
          <input
            id="edit-cta"
            type="text"
            className="form-control form-control-sm"
            value={ctaText}
            onChange={onChangeCta}
            required
            disabled={isSubmitting}
          />
        </div>
      </div>

      <div className="mb-3">
        <label htmlFor="edit-objective" className="form-label text-sm font-weight-bold">
          Mục tiêu video
        </label>
        <input
          id="edit-objective"
          type="text"
          className="form-control form-control-sm"
          value={videoObjective}
          onChange={onChangeObjective}
          required
          disabled={isSubmitting}
        />
      </div>

      <div className="row g-3 mb-3">
        <div className="col-12 col-md-6">
          <label htmlFor="edit-hook-spoken" className="form-label text-sm font-weight-bold">
            Hook mở đầu (Lời thoại)
          </label>
          <textarea
            id="edit-hook-spoken"
            rows={2}
            className="form-control form-control-sm"
            value={spokenHook}
            onChange={onChangeSpokenHook}
            required
            disabled={isSubmitting}
          />
        </div>
        <div className="col-12 col-md-6">
          <label htmlFor="edit-hook-visual" className="form-label text-sm font-weight-bold">
            Hook mở đầu (Hình ảnh)
          </label>
          <textarea
            id="edit-hook-visual"
            rows={2}
            className="form-control form-control-sm"
            value={visualHook}
            onChange={onChangeVisualHook}
            required
            disabled={isSubmitting}
          />
        </div>
      </div>

      <div className="mb-3">
        <label htmlFor="edit-voiceover" className="form-label text-sm font-weight-bold">
          Toàn bộ kịch bản Lời thoại (Voice-over)
        </label>
        <textarea
          id="edit-voiceover"
          rows={5}
          className="form-control form-control-sm font-monospace text-sm"
          value={voiceOver}
          onChange={onChangeVoiceOver}
          required
          disabled={isSubmitting}
        />
      </div>

      <div className="row g-3 mb-3">
        <div className="col-12 col-md-6">
          <label htmlFor="edit-disclosure" className="form-label text-sm font-weight-bold">
            Công bố minh bạch (Disclosure)
          </label>
          <input
            id="edit-disclosure"
            type="text"
            className="form-control form-control-sm"
            value={disclosureText}
            onChange={onChangeDisclosure}
            required
            disabled={isSubmitting}
          />
        </div>
        <div className="col-12 col-md-6">
          <label htmlFor="edit-note" className="form-label text-sm font-weight-bold">
            Ghi chú thay đổi (Tùy chọn)
          </label>
          <input
            id="edit-note"
            type="text"
            className="form-control form-control-sm"
            placeholder="Ví dụ: Cập nhật lại câu từ lời thoại cho tự nhiên hơn"
            value={note}
            onChange={onChangeNote}
            disabled={isSubmitting}
          />
        </div>
      </div>
    </>
  );
}
