import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface MotionPhotoPlayerProps {
  posterUrl: string;
  motionUrl: string;
  alt: string;
  presentationTimestampUs?: bigint;
  containerClassName?: string;
  mediaClassName?: string;
  posterClassName?: string;
  videoClassName?: string;
  active?: boolean;
  loop?: boolean;
}

const MotionPhotoPlayer = ({
  posterUrl,
  motionUrl,
  alt,
  presentationTimestampUs,
  containerClassName,
  mediaClassName,
  posterClassName,
  videoClassName,
  active,
  loop = false,
}: MotionPhotoPlayerProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [mediaError, setMediaError] = useState(false);
  const [retry, setRetry] = useState(0);
  // Latched on first activation: the source stays bound afterwards so repeated
  // hovers replay the already-buffered video instead of refetching it.
  const [hasActivated, setHasActivated] = useState(false);

  const resetPlaybackPosition = useCallback(
    (video: HTMLVideoElement) => {
      const startTime = presentationTimestampUs && presentationTimestampUs > 0n ? Number(presentationTimestampUs) / 1_000_000 : 0;
      video.currentTime = startTime;
    },
    [presentationTimestampUs],
  );

  const stopPlayback = useCallback(
    (resetPosition = true) => {
      const video = videoRef.current;
      if (!video) {
        return;
      }

      video.pause();
      if (resetPosition && video.readyState >= 1) {
        resetPlaybackPosition(video);
      }
      setIsPlaying(false);
    },
    [resetPlaybackPosition],
  );

  const startPlayback = useCallback(
    async (loop: boolean) => {
      const video = videoRef.current;
      if (!video) {
        return;
      }

      video.loop = loop;
      if (video.readyState >= 1) {
        resetPlaybackPosition(video);
      }

      try {
        await video.play();
        setIsPlaying(true);
      } catch {
        setIsPlaying(false);
        setMediaError(true);
      }
    },
    [resetPlaybackPosition],
  );

  useEffect(() => stopPlayback, [stopPlayback]);

  useEffect(() => {
    if (!active) {
      stopPlayback();
      return;
    }

    setHasActivated(true);
    void startPlayback(loop);
  }, [active, loop, startPlayback, stopPlayback]);

  return (
    <div className={cn("relative overflow-hidden", containerClassName)}>
      <img
        key={`poster-${retry}`}
        onError={() => setMediaError(true)}
        src={posterUrl}
        alt={alt}
        className={cn("block max-h-full max-w-full select-none object-cover", mediaClassName, posterClassName)}
        draggable={false}
        loading="lazy"
        decoding="async"
      />
      <video
        key={`motion-${retry}`}
        onError={() => {
          setIsPlaying(false);
          setMediaError(true);
        }}
        onLoadedData={() => setMediaError(false)}
        ref={videoRef}
        src={active || hasActivated ? motionUrl : undefined}
        poster={posterUrl}
        className={cn(
          "pointer-events-none absolute inset-0 h-full w-full object-cover transition-opacity duration-200",
          isPlaying ? "opacity-100" : "opacity-0",
          mediaClassName,
          videoClassName,
        )}
        muted
        playsInline
        preload="none"
        disableRemotePlayback
        onLoadedMetadata={(event) => resetPlaybackPosition(event.currentTarget)}
        onEnded={() => stopPlayback()}
      />
      {mediaError && (
        <div role="alert" className="relative z-10 space-y-1 bg-background/90 p-3 text-xs text-foreground">
          <p>此浏览器暂时无法预览动态照片，可下载文件后打开。</p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className="underline"
              onClick={() => {
                setMediaError(false);
                setRetry((value) => value + 1);
              }}
            >
              重试
            </button>
            <a href={posterUrl} download className="underline">
              下载图片
            </a>
            <a href={motionUrl} download className="underline">
              下载动态片段
            </a>
          </div>
        </div>
      )}
    </div>
  );
};

export default MotionPhotoPlayer;
