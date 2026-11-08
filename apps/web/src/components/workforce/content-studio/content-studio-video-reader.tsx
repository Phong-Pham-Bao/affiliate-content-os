'use client';

import type { ReactElement } from 'react';
import type { ScriptVideo } from '../../../types/script-studio.js';
import { ContentStudioVideoScenesTable } from './content-studio-video-scenes-table.js';

interface ContentStudioVideoReaderProps {
  readonly video: ScriptVideo;
}

export function ContentStudioVideoReader({ video }: ContentStudioVideoReaderProps): ReactElement {
  const videoNum = video.videoNumber;

  return (
    <article
      id={`video-panel-${videoNum}`}
      role="tabpanel"
      aria-labelledby={`video-tab-${videoNum}`}
      className="content-studio-video-reader bg-white p-4 border rounded shadow-sm"
    >
      <header className="mb-4 pb-3 border-bottom d-flex justify-content-between align-items-start flex-wrap gap-2">
        <div>
          <h4 className="mb-1 text-primary">
            Video {videoNum}: {video.title}
          </h4>
          <p className="text-muted text-sm mb-0">
            <strong>Mục tiêu:</strong> {video.objective}
          </p>
        </div>
        <div className="text-end">
          <span className="badge badge-info text-sm">
            Thời lượng dự kiến: ~{video.targetDurationSeconds}s
          </span>
        </div>
      </header>

      {/* Hook / Mở đầu */}
      <section className="mb-4 p-3 bg-light rounded" aria-labelledby={`hook-title-${videoNum}`}>
        <h5
          id={`hook-title-${videoNum}`}
          className="text-sm font-weight-bold text-uppercase text-secondary mb-2"
        >
          Hook &amp; Mở đầu gây chú ý
        </h5>
        <div className="mb-2">
          <strong>Lời thoại mở đầu:</strong>{' '}
          <em className="text-dark">&ldquo;{video.hook.spokenHook}&rdquo;</em>
        </div>
        <div className="text-sm text-muted">
          <strong>Hình ảnh mở đầu:</strong> {video.hook.visualHook}
        </div>
      </section>

      {/* Toàn bộ Lời thoại (Voice-over) */}
      <section className="mb-4" aria-labelledby={`vo-title-${videoNum}`}>
        <h5
          id={`vo-title-${videoNum}`}
          className="text-sm font-weight-bold text-uppercase text-secondary mb-2"
        >
          Kịch bản Lời thoại (Voice-over)
        </h5>
        <div className="p-3 border rounded bg-light-subtle text-dark whitespace-pre-wrap leading-relaxed">
          {video.voiceOver}
        </div>
      </section>

      {/* Phân cảnh chi tiết */}
      <ContentStudioVideoScenesTable scenes={video.scenes} videoNumber={videoNum} />

      {/* Overlays & CTA & Disclosure */}
      <div className="row g-3 mb-4">
        {video.onScreenOverlays.length > 0 && (
          <div className="col-12 col-md-6">
            <section
              className="p-3 border rounded h-100"
              aria-labelledby={`overlays-title-${videoNum}`}
            >
              <h5
                id={`overlays-title-${videoNum}`}
                className="text-sm font-weight-bold text-secondary mb-2"
              >
                Lớp phủ màn hình (Overlays)
              </h5>
              <ul className="list-unstyled mb-0 text-sm">
                {video.onScreenOverlays.map((ov, oIdx) => (
                  <li key={oIdx} className="mb-2 pb-2 border-bottom">
                    <span className="badge badge-secondary me-2">[{ov.placement}]</span>
                    <span className="text-muted text-xs">
                      ({ov.timeRangeSeconds.start}s - {ov.timeRangeSeconds.end}s)
                    </span>
                    <div className="mt-1 font-weight-bold">&ldquo;{ov.text}&rdquo;</div>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        )}

        <div className="col-12 col-md-6">
          <section className="p-3 border rounded h-100" aria-labelledby={`cta-title-${videoNum}`}>
            <h5
              id={`cta-title-${videoNum}`}
              className="text-sm font-weight-bold text-secondary mb-2"
            >
              Kêu gọi hành động &amp; Minh bạch
            </h5>
            <div className="mb-3">
              <strong>Kêu gọi hành động (CTA):</strong>
              <div className="mt-1 font-weight-bold text-success">
                &ldquo;{video.callToAction.text}&rdquo;
              </div>
              <div className="text-xs text-muted mt-1">
                Hướng dẫn hình ảnh: {video.callToAction.visualDirection}
              </div>
            </div>
            <div className="pt-2 border-top">
              <strong>Công bố minh bạch (Disclosure):</strong>
              <div className="text-xs text-muted mt-1">
                [{video.disclosure.placement}]: &ldquo;{video.disclosure.text}&rdquo;
              </div>
            </div>
          </section>
        </div>
      </div>

      {/* Danh sách cảnh quay (Shot List) */}
      {video.shotList.length > 0 && (
        <section className="mb-4" aria-labelledby={`shotlist-title-${videoNum}`}>
          <h5
            id={`shotlist-title-${videoNum}`}
            className="text-sm font-weight-bold text-uppercase text-secondary mb-3"
          >
            Danh sách cảnh quay sản xuất (Shot List - {video.shotList.length} shots)
          </h5>
          <div className="table-responsive">
            <table className="table table-bordered table-sm text-sm mb-0">
              <thead className="thead-light">
                <tr>
                  <th style={{ width: '8%' }}>Shot</th>
                  <th style={{ width: '10%' }}>Thời lượng</th>
                  <th style={{ width: '30%' }}>Mô tả</th>
                  <th style={{ width: '18%' }}>Góc máy</th>
                  <th style={{ width: '17%' }}>Khung hình &amp; Chuyển động</th>
                  <th style={{ width: '17%' }}>Đạo cụ</th>
                </tr>
              </thead>
              <tbody>
                {video.shotList.map((sh) => (
                  <tr key={sh.shotNumber}>
                    <td className="font-weight-bold text-center">#{sh.shotNumber}</td>
                    <td className="text-muted">{sh.durationSeconds}s</td>
                    <td>{sh.description}</td>
                    <td>{sh.cameraAngle}</td>
                    <td>
                      <div>{sh.framing}</div>
                      <div className="text-xs text-muted">{sh.movement}</div>
                    </td>
                    <td>
                      {sh.props.length > 0 ? (
                        <div className="d-flex gap-1 flex-wrap">
                          {sh.props.map((p, pIdx) => (
                            <span key={pIdx} className="badge badge-light border text-xs">
                              {p}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-muted text-xs">&mdash;</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Nguồn bằng chứng & Giả thuyết sáng tạo */}
      <footer className="pt-3 border-top d-flex justify-content-between align-items-center flex-wrap gap-2 text-xs">
        <div>
          <strong>Bằng chứng liên kết ({video.evidenceReferences.length}):</strong>{' '}
          {video.evidenceReferences.map((ev, eIdx) => (
            <span key={eIdx} className="badge badge-info ms-1">
              {ev.sourceKind === 'product_fact' ? 'Fact' : 'Analysis'}: {ev.sourceId.slice(0, 8)}...
            </span>
          ))}
        </div>
        {video.creativeHypotheses.length > 0 && (
          <div>
            <strong>Giả thuyết sáng tạo:</strong>{' '}
            <span className="text-muted">{video.creativeHypotheses.join(' • ')}</span>
          </div>
        )}
      </footer>
    </article>
  );
}
