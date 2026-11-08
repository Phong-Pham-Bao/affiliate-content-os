import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createMockScriptPackage } from './content-studio-components.unit.test.js';
import { ContentStudioFieldCompare } from '../src/components/workforce/content-studio/content-studio-field-compare.js';
import { ContentStudioManualEditor } from '../src/components/workforce/content-studio/content-studio-manual-editor.js';
import { ContentStudioRequestChangesDialog } from '../src/components/workforce/content-studio/content-studio-request-changes-dialog.js';
import { ContentStudioHeaderToolbar } from '../src/components/workforce/content-studio/content-studio-header-toolbar.js';

describe('Content Studio - Interactive Views & Dialogs', () => {
  const basePkg = createMockScriptPackage();
  const modifiedPkg = {
    ...basePkg,
    videos: [
      {
        ...basePkg.videos[0],
        title: 'Video 1: Cải thiện hiệu suất 200% với tư thế ngồi chuẩn',
        hook: {
          spokenHook: 'Bạn đã thử ngồi ghế công thái học thế hệ mới chưa?',
          visualHook: 'Cảnh nhân viên ngồi thư thái mỉm cười',
        },
        callToAction: {
          ...basePkg.videos[0].callToAction,
          text: 'Bấm ngay vào giỏ hàng bên dưới để nhận ưu đãi 20%!',
        },
      },
      basePkg.videos[1],
      basePkg.videos[2],
      basePkg.videos[3],
      basePkg.videos[4],
    ] as unknown as [
      import('../src/types/script-studio.js').ScriptVideo,
      import('../src/types/script-studio.js').ScriptVideo,
      import('../src/types/script-studio.js').ScriptVideo,
      import('../src/types/script-studio.js').ScriptVideo,
      import('../src/types/script-studio.js').ScriptVideo,
    ],
  };

  it('renders field-aware compare highlighting differences without dumping raw JSON', () => {
    const html = renderToStaticMarkup(
      <ContentStudioFieldCompare
        baseRevNumber={1}
        basePackage={basePkg}
        targetRevNumber={2}
        targetPackage={modifiedPkg}
        videoIndex={0}
        onClose={() => {}}
      />,
    );

    expect(html).toContain('So sánh trường: Phiên bản #1 vs #2 (Video 1)');
    expect(html).toContain('Tiêu đề video');
    expect(html).toContain('Video 1: Đánh thức năng lượng làm việc');
    expect(html).toContain('Video 1: Cải thiện hiệu suất 200% với tư thế ngồi chuẩn');
    expect(html).toContain('Hook (Lời thoại)');
    expect(html).toContain('Bạn đã thử ngồi ghế công thái học thế hệ mới chưa?');
    expect(html).toContain('Lời kêu gọi (CTA)');
    expect(html).toContain('Bấm ngay vào giỏ hàng bên dưới để nhận ưu đãi 20%!');
    expect(html).toContain('table-warning');
  });

  it('renders structured manual editor with inputs, preconditions, and note', () => {
    const html = renderToStaticMarkup(
      <ContentStudioManualEditor
        pkg={basePkg}
        videoIndex={0}
        baseRevisionNumber={1}
        baseContentHashHex="abcdef1234567890abcdef1234567890"
        expectedVersion={1}
        isSubmitting={false}
        error={null}
        onSave={async () => {}}
        onCancel={() => {}}
      />,
    );

    expect(html).toContain('Chỉnh sửa kịch bản có cấu trúc • Video 1');
    expect(html).toContain('Phiên bản #2 bất biến');
    expect(html).toContain('id="edit-title"');
    expect(html).toContain('id="edit-objective"');
    expect(html).toContain('id="edit-hook-spoken"');
    expect(html).toContain('id="edit-voiceover"');
    expect(html).toContain('id="edit-cta"');
    expect(html).toContain('id="edit-disclosure"');
    expect(html).toContain('id="edit-note"');
    expect(html).toContain('Lưu bản chỉnh sửa bất biến');
  });

  it('renders selected-video request changes dialog with video checkboxes and instructions', () => {
    const html = renderToStaticMarkup(
      <ContentStudioRequestChangesDialog
        isOpen={true}
        baseRevisionNumber={1}
        baseContentHashHex="abcdef1234567890abcdef1234567890"
        isSubmitting={false}
        error={null}
        onSubmit={async () => {}}
        onClose={() => {}}
      />,
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('Yêu cầu thay đổi kịch bản (AI Request Changes)');
    expect(html).toContain('Video 1');
    expect(html).toContain('Video 2');
    expect(html).toContain('Video 3');
    expect(html).toContain('Video 4');
    expect(html).toContain('Video 5');
    expect(html).toContain('id="req-instruction"');
    expect(html).toContain('id="req-variants"');
    expect(html).toContain('Gửi yêu cầu thay đổi');
  });

  it('renders toolbar with permissions and mode switches', () => {
    const htmlOwner = renderToStaticMarkup(
      <ContentStudioHeaderToolbar
        seriesTitle="Chiến dịch Ergonomic"
        canManage={true}
        isEditing={false}
        isComparing={false}
        isHistoryOpen={false}
        onToggleHistory={() => {}}
        onStartEdit={() => {}}
        onOpenRequestChanges={() => {}}
      />,
    );

    expect(htmlOwner).toContain('Content Studio • Chiến dịch Ergonomic');
    expect(htmlOwner).toContain('Lịch sử phiên bản');
    expect(htmlOwner).toContain('Chỉnh sửa thủ công');
    expect(htmlOwner).toContain('Yêu cầu AI viết lại');

    const htmlViewer = renderToStaticMarkup(
      <ContentStudioHeaderToolbar
        seriesTitle="Chiến dịch Ergonomic"
        canManage={false}
        isEditing={false}
        isComparing={false}
        isHistoryOpen={false}
        onToggleHistory={() => {}}
        onStartEdit={() => {}}
        onOpenRequestChanges={() => {}}
      />,
    );

    expect(htmlViewer).not.toContain('Chỉnh sửa thủ công');
    expect(htmlViewer).not.toContain('Yêu cầu AI viết lại');
  });
});
