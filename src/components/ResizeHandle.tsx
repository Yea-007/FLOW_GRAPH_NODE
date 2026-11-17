import { useCallback, useEffect, useRef } from "react";

interface ResizeHandleProps {
  onDrag: (delta: number) => void;
  disabled?: boolean;
  className?: string;
}

export function ResizeHandle({
  onDrag,
  disabled = false,
  className = "",
}: ResizeHandleProps) {
  const dragging = useRef(false);
  const startX = useRef(0);

  const handleMouseDown = useCallback(
    (event: React.MouseEvent) => {
      if (disabled) return;
      event.preventDefault();
      dragging.current = true;
      startX.current = event.clientX;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.body.style.pointerEvents = "none";
      (event.target as HTMLElement).closest(".resize-area")?.classList.add("pointer-events-none");
    },
    [disabled],
  );

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (!dragging.current) return;
      const delta = event.clientX - startX.current;
      startX.current = event.clientX;
      onDrag(delta);
    };

    const handleMouseUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.body.style.pointerEvents = "";
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [onDrag]);

  return (
    <div
      className={`resize-handle ${disabled ? "pointer-events-none opacity-0" : ""} ${className}`}
      onMouseDown={handleMouseDown}
    />
  );
}
