'use client';

import { useState, type ChangeEvent, type FormEvent, type ReactElement } from 'react';
import type { ScriptPackage, ScriptVideo } from '../../../types/script-studio.js';
import { ContentStudioManualEditorFields } from './content-studio-manual-editor-fields.js';

interface ContentStudioManualEditorProps {
  readonly pkg: ScriptPackage;
  readonly videoIndex: number;
  readonly baseRevisionNumber: number;
  readonly baseContentHashHex: string;
  readonly expectedVersion: number;
  readonly isSubmitting: boolean;
  readonly error: string | null;
  readonly onSave: (updatedPackage: ScriptPackage, note: string) => Promise<void>;
  readonly onCancel: () => void;
}

export function ContentStudioManualEditor({
  pkg,
  videoIndex,
  baseRevisionNumber,
  baseContentHashHex,
  expectedVersion,
  isSubmitting,
  error,
  onSave,
  onCancel,
}: ContentStudioManualEditorProps): ReactElement {
  const currentVideo = pkg.videos[videoIndex] ?? pkg.videos[0];
  const [videoTitle, setVideoTitle] = useState(currentVideo.title);
  const [videoObjective, setVideoObjective] = useState(currentVideo.objective);
  const [spokenHook, setSpokenHook] = useState(currentVideo.hook.spokenHook);
  const [visualHook, setVisualHook] = useState(currentVideo.hook.visualHook);
  const [voiceOver, setVoiceOver] = useState(currentVideo.voiceOver);
  const [ctaText, setCtaText] = useState(currentVideo.callToAction.text);
  const [disclosureText, setDisclosureText] = useState(currentVideo.disclosure.text);
  const [note, setNote] = useState('');
  const [hasChanges, setHasChanges] = useState(false);

  const handleChange =
    (setter: (val: string) => void) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setter(e.target.value);
      setHasChanges(true);
    };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    const updatedVideo: ScriptVideo = {
      ...currentVideo,
      title: videoTitle.trim(),
      objective: videoObjective.trim(),
      hook: {
        spokenHook: spokenHook.trim(),
        visualHook: visualHook.trim(),
      },
      voiceOver: voiceOver.trim(),
      callToAction: {
        ...currentVideo.callToAction,
        text: ctaText.trim(),
      },
      disclosure: {
        ...currentVideo.disclosure,
        text: disclosureText.trim(),
      },
    };

    const updatedVideos = [...pkg.videos] as [
      ScriptVideo,
      ScriptVideo,
      ScriptVideo,
      ScriptVideo,
      ScriptVideo,
    ];
    updatedVideos[videoIndex] = updatedVideo;

    const updatedPkg: ScriptPackage = {
      ...pkg,
      videos: updatedVideos,
    };

    await onSave(updatedPkg, note.trim());
  };

  const handleCancelClick = () => {
    if (hasChanges && !window.confirm('Bạn có thay đổi chưa lưu. Bạn có chắc muốn hủy bỏ?')) {
      return;
    }
    onCancel();
  };

  return (
    <form
      className="content-studio-manual-editor bg-white p-4 border rounded shadow-sm mb-4"
      onSubmit={handleSubmit}
      aria-label="Biểu mẫu chỉnh sửa kịch bản có cấu trúc"
    >
      <header className="d-flex justify-content-between align-items-center mb-3 pb-2 border-bottom">
        <div>
          <h5 className="mb-1 text-primary">
            Chỉnh sửa kịch bản có cấu trúc &bull; Video {currentVideo.videoNumber}
          </h5>
          <span className="text-muted text-xs">
            Bản ghi mới sẽ tạo Phiên bản #{baseRevisionNumber + 1} bất biến. Tiền điều kiện: Rev #
            {baseRevisionNumber} ({baseContentHashHex.slice(0, 8)}...), Ver: {expectedVersion}.
          </span>
        </div>
        <button
          type="button"
          className="btn btn-sm btn-outline-secondary"
          onClick={handleCancelClick}
          disabled={isSubmitting}
        >
          Hủy bỏ
        </button>
      </header>

      {error && (
        <div role="alert" className="alert alert-danger p-2 mb-3 text-sm rounded">
          {error}
        </div>
      )}

      <ContentStudioManualEditorFields
        videoTitle={videoTitle}
        videoObjective={videoObjective}
        spokenHook={spokenHook}
        visualHook={visualHook}
        voiceOver={voiceOver}
        ctaText={ctaText}
        disclosureText={disclosureText}
        note={note}
        isSubmitting={isSubmitting}
        onChangeTitle={handleChange(setVideoTitle)}
        onChangeObjective={handleChange(setVideoObjective)}
        onChangeSpokenHook={handleChange(setSpokenHook)}
        onChangeVisualHook={handleChange(setVisualHook)}
        onChangeVoiceOver={handleChange(setVoiceOver)}
        onChangeCta={handleChange(setCtaText)}
        onChangeDisclosure={handleChange(setDisclosureText)}
        onChangeNote={(e) => setNote(e.target.value)}
      />

      <footer className="d-flex justify-content-end gap-2 pt-3 border-top">
        <button
          type="button"
          className="btn btn-sm btn-secondary"
          onClick={handleCancelClick}
          disabled={isSubmitting}
        >
          Hủy bỏ
        </button>
        <button
          type="submit"
          className="btn btn-sm btn-primary"
          disabled={isSubmitting || !hasChanges}
        >
          {isSubmitting ? 'Đang lưu phiên bản mới...' : 'Lưu bản chỉnh sửa bất biến'}
        </button>
      </footer>
    </form>
  );
}
