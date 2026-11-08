'use client';

import type { ReactElement } from 'react';
import type { ScriptScene } from '../../../types/script-studio.js';

interface ContentStudioVideoScenesTableProps {
  readonly scenes: readonly ScriptScene[];
  readonly videoNumber: number;
}

export function ContentStudioVideoScenesTable({
  scenes,
  videoNumber,
}: ContentStudioVideoScenesTableProps): ReactElement {
  return (
    <section className="mb-4" aria-labelledby={`scenes-title-${videoNumber}`}>
      <h5
        id={`scenes-title-${videoNumber}`}
        className="text-sm font-weight-bold text-uppercase text-secondary mb-3"
      >
        Phân cảnh ({scenes.length} cảnh)
      </h5>
      <div className="table-responsive">
        <table className="table table-bordered table-sm text-sm mb-0">
          <thead className="thead-light">
            <tr>
              <th style={{ width: '8%' }}>Cảnh</th>
              <th style={{ width: '12%' }}>Thời gian</th>
              <th style={{ width: '40%' }}>Mô tả hình ảnh</th>
              <th style={{ width: '40%' }}>Lời thoại &amp; Âm thanh</th>
            </tr>
          </thead>
          <tbody>
            {scenes.map((sc) => (
              <tr key={sc.sceneNumber}>
                <td className="font-weight-bold text-center">#{sc.sceneNumber}</td>
                <td className="text-muted">
                  {sc.timeRangeSeconds.start}s &ndash; {sc.timeRangeSeconds.end}s
                </td>
                <td>{sc.visualDescription}</td>
                <td>
                  <div>{sc.spokenText}</div>
                  {sc.audioCue && (
                    <div className="text-xs text-muted mt-1">
                      <em>Âm thanh: {sc.audioCue}</em>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
