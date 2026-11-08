'use client';

import type { ReactElement } from 'react';
import type { ScriptPackage } from '../../../types/script-studio.js';

interface ContentStudioFieldCompareProps {
  readonly baseRevNumber: number;
  readonly basePackage: ScriptPackage;
  readonly targetRevNumber: number;
  readonly targetPackage: ScriptPackage;
  readonly videoIndex: number;
  readonly onClose: () => void;
}

export function ContentStudioFieldCompare({
  baseRevNumber,
  basePackage,
  targetRevNumber,
  targetPackage,
  videoIndex,
  onClose,
}: ContentStudioFieldCompareProps): ReactElement {
  const baseVid = basePackage.videos[videoIndex] ?? basePackage.videos[0];
  const targetVid = targetPackage.videos[videoIndex] ?? targetPackage.videos[0];
  const videoNum = baseVid.videoNumber;

  const titleChanged = baseVid.title !== targetVid.title;
  const hookSpokenChanged = baseVid.hook.spokenHook !== targetVid.hook.spokenHook;
  const hookVisualChanged = baseVid.hook.visualHook !== targetVid.hook.visualHook;
  const voChanged = baseVid.voiceOver !== targetVid.voiceOver;
  const ctaChanged = baseVid.callToAction.text !== targetVid.callToAction.text;
  const disclosureChanged = baseVid.disclosure.text !== targetVid.disclosure.text;
  const sceneCountChanged = baseVid.scenes.length !== targetVid.scenes.length;
  const shotCountChanged = baseVid.shotList.length !== targetVid.shotList.length;

  return (
    <section
      className="content-studio-field-compare bg-white p-4 border rounded shadow-sm mb-4"
      role="region"
      aria-label={`So sánh phiên bản #${baseRevNumber} và #${targetRevNumber}`}
    >
      <header className="d-flex justify-content-between align-items-center mb-3 pb-2 border-bottom">
        <div>
          <h5 className="mb-1 text-primary">
            So sánh trường: Phiên bản #{baseRevNumber} vs #{targetRevNumber} (Video {videoNum})
          </h5>
          <span className="text-muted text-xs">
            Hiển thị trực quan các thay đổi theo từng trường nội dung, không xuất raw JSON.
          </span>
        </div>
        <button
          type="button"
          className="btn btn-sm btn-outline-secondary"
          onClick={onClose}
          aria-label="Đóng so sánh"
        >
          &times; Đóng so sánh
        </button>
      </header>

      <div className="table-responsive">
        <table className="table table-bordered text-sm mb-0">
          <thead className="thead-light">
            <tr>
              <th style={{ width: '20%' }}>Trường nội dung</th>
              <th style={{ width: '40%' }}>Phiên bản #{baseRevNumber} (Gốc)</th>
              <th style={{ width: '40%' }}>Phiên bản #{targetRevNumber} (Mới)</th>
            </tr>
          </thead>
          <tbody>
            <tr className={titleChanged ? 'table-warning' : ''}>
              <td>
                <strong>Tiêu đề video</strong>
                {titleChanged && <span className="badge badge-warning ms-1 text-xs">Thay đổi</span>}
              </td>
              <td>{baseVid.title}</td>
              <td className={titleChanged ? 'font-weight-bold text-primary' : ''}>
                {targetVid.title}
              </td>
            </tr>

            <tr className={hookSpokenChanged ? 'table-warning' : ''}>
              <td>
                <strong>Hook (Lời thoại)</strong>
                {hookSpokenChanged && (
                  <span className="badge badge-warning ms-1 text-xs">Thay đổi</span>
                )}
              </td>
              <td>&ldquo;{baseVid.hook.spokenHook}&rdquo;</td>
              <td className={hookSpokenChanged ? 'font-weight-bold text-primary' : ''}>
                &ldquo;{targetVid.hook.spokenHook}&rdquo;
              </td>
            </tr>

            <tr className={hookVisualChanged ? 'table-warning' : ''}>
              <td>
                <strong>Hook (Hình ảnh)</strong>
                {hookVisualChanged && (
                  <span className="badge badge-warning ms-1 text-xs">Thay đổi</span>
                )}
              </td>
              <td>{baseVid.hook.visualHook}</td>
              <td className={hookVisualChanged ? 'font-weight-bold text-primary' : ''}>
                {targetVid.hook.visualHook}
              </td>
            </tr>

            <tr className={voChanged ? 'table-warning' : ''}>
              <td>
                <strong>Toàn bộ Voice-over</strong>
                {voChanged && <span className="badge badge-warning ms-1 text-xs">Thay đổi</span>}
              </td>
              <td className="whitespace-pre-wrap text-xs">{baseVid.voiceOver}</td>
              <td className={`whitespace-pre-wrap text-xs ${voChanged ? 'text-primary' : ''}`}>
                {targetVid.voiceOver}
              </td>
            </tr>

            <tr className={sceneCountChanged ? 'table-warning' : ''}>
              <td>
                <strong>Số phân cảnh</strong>
                {sceneCountChanged && (
                  <span className="badge badge-warning ms-1 text-xs">Thay đổi</span>
                )}
              </td>
              <td>{baseVid.scenes.length} cảnh</td>
              <td className={sceneCountChanged ? 'font-weight-bold text-primary' : ''}>
                {targetVid.scenes.length} cảnh
              </td>
            </tr>

            <tr className={ctaChanged ? 'table-warning' : ''}>
              <td>
                <strong>Lời kêu gọi (CTA)</strong>
                {ctaChanged && <span className="badge badge-warning ms-1 text-xs">Thay đổi</span>}
              </td>
              <td>&ldquo;{baseVid.callToAction.text}&rdquo;</td>
              <td className={ctaChanged ? 'font-weight-bold text-primary' : ''}>
                &ldquo;{targetVid.callToAction.text}&rdquo;
              </td>
            </tr>

            <tr className={disclosureChanged ? 'table-warning' : ''}>
              <td>
                <strong>Minh bạch (Disclosure)</strong>
                {disclosureChanged && (
                  <span className="badge badge-warning ms-1 text-xs">Thay đổi</span>
                )}
              </td>
              <td>&ldquo;{baseVid.disclosure.text}&rdquo;</td>
              <td className={disclosureChanged ? 'font-weight-bold text-primary' : ''}>
                &ldquo;{targetVid.disclosure.text}&rdquo;
              </td>
            </tr>

            <tr className={shotCountChanged ? 'table-warning' : ''}>
              <td>
                <strong>Số cảnh quay (Shots)</strong>
                {shotCountChanged && (
                  <span className="badge badge-warning ms-1 text-xs">Thay đổi</span>
                )}
              </td>
              <td>{baseVid.shotList.length} shots</td>
              <td className={shotCountChanged ? 'font-weight-bold text-primary' : ''}>
                {targetVid.shotList.length} shots
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
