'use client';

import type { KeyboardEvent, ReactElement } from 'react';
import type { ScriptVideo } from '../../../types/script-studio.js';

interface ContentStudioVideoNavProps {
  readonly videos: readonly ScriptVideo[];
  readonly selectedIndex: number;
  readonly onSelectVideo: (index: number) => void;
}

export function ContentStudioVideoNav({
  videos,
  selectedIndex,
  onSelectVideo,
}: ContentStudioVideoNavProps): ReactElement {
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const count = videos.length;
    if (count === 0) return;

    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      onSelectVideo((selectedIndex + 1) % count);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      onSelectVideo((selectedIndex - 1 + count) % count);
    } else if (e.key === 'Home') {
      e.preventDefault();
      onSelectVideo(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      onSelectVideo(count - 1);
    }
  };

  return (
    <nav
      className="content-studio-video-nav mb-4"
      role="tablist"
      aria-label="Điều hướng 5 video"
      onKeyDown={handleKeyDown}
    >
      <div className="d-flex gap-2 flex-wrap">
        {videos.map((vid, idx) => {
          const isSelected = idx === selectedIndex;
          const videoNum = vid.videoNumber ?? idx + 1;
          const duration = vid.targetDurationSeconds ?? 60;
          return (
            <button
              key={videoNum}
              type="button"
              role="tab"
              id={`video-tab-${videoNum}`}
              aria-selected={isSelected}
              aria-controls={`video-panel-${videoNum}`}
              tabIndex={isSelected ? 0 : -1}
              className={`btn btn-sm text-start p-2 border rounded ${
                isSelected
                  ? 'btn-primary active font-weight-bold shadow-sm'
                  : 'btn-outline-secondary bg-white'
              }`}
              onClick={() => onSelectVideo(idx)}
            >
              <div className="d-flex justify-content-between align-items-center gap-2">
                <span>
                  <strong>Video {videoNum}</strong>
                </span>
                <span className="badge badge-light text-xs">{duration}s</span>
              </div>
              <div
                className="text-truncate text-xs mt-1"
                style={{ maxWidth: '140px' }}
                title={vid.title || `Video ${videoNum}`}
              >
                {vid.title || `Video ${videoNum}`}
              </div>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
