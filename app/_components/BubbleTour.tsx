"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

export type TourStep = {
  id: string;
  selector: string;
  title: string;
  body: React.ReactNode;
  placement?: "top" | "bottom" | "left" | "right";
  offset?: number;
};

type Props = {
  tourId: string;
  steps: TourStep[];
  autoStart?: boolean;
  storageKey?: string;
  /** If true, opens even if localStorage says "done" */
  forceOpen?: boolean;
};

type Pos = { top: number; left: number; placement: NonNullable<TourStep["placement"]> };

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function computePos(targetRect: DOMRect, bubbleRect: DOMRect, placement: Pos["placement"], offset: number): Pos {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let top = 0;
  let left = 0;

  const centerX = targetRect.left + targetRect.width / 2;
  const centerY = targetRect.top + targetRect.height / 2;

  switch (placement) {
    case "top":
      top = targetRect.top - bubbleRect.height - offset;
      left = centerX - bubbleRect.width / 2;
      break;
    case "bottom":
      top = targetRect.bottom + offset;
      left = centerX - bubbleRect.width / 2;
      break;
    case "left":
      top = centerY - bubbleRect.height / 2;
      left = targetRect.left - bubbleRect.width - offset;
      break;
    case "right":
    default:
      top = centerY - bubbleRect.height / 2;
      left = targetRect.right + offset;
      break;
  }

  const pad = 16;
  top = clamp(top, pad, vh - bubbleRect.height - pad);
  left = clamp(left, pad, vw - bubbleRect.width - pad);

  return { top, left, placement };
}

export function BubbleTour({ tourId, steps, autoStart = true, storageKey, forceOpen = false }: Props) {
  const key = storageKey ?? `cc_tour_done__${tourId}`;

  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(0);
  const [pos, setPos] = useState<Pos | null>(null);

  const bubbleRef = useRef<HTMLDivElement | null>(null);

  const step = useMemo(() => steps[idx] ?? null, [steps, idx]);

  function markDone() {
    try {
      localStorage.setItem(key, "1");
    } catch {}
  }

  function clearHighlights() {
    document.querySelectorAll("[data-cc-tour-highlight]").forEach((el) => {
      const html = el as HTMLElement;
      html.style.boxShadow = "";
      html.style.borderRadius = "";
      html.removeAttribute("data-cc-tour-highlight");
    });
  }

  function closeTour(done: boolean) {
    if (done) markDone();
    setOpen(false);
    setPos(null);
    clearHighlights();
  }

  function next() {
    if (!steps.length) return closeTour(true);
    if (idx >= steps.length - 1) return closeTour(true);
    setIdx((i) => i + 1);
  }

  function back() {
    setIdx((i) => Math.max(0, i - 1));
  }

  // Auto-start once (unless forceOpen)
  useEffect(() => {
    if (!autoStart) return;

    if (forceOpen) {
      setOpen(true);
      return;
    }

    try {
      const done = localStorage.getItem(key) === "1";
      if (!done) setOpen(true);
    } catch {
      setOpen(true);
    }
  }, [autoStart, key, forceOpen]);

  // Skip missing elements
  useEffect(() => {
    if (!open) return;
    if (!step) return;

    const el = document.querySelector(step.selector) as HTMLElement | null;
    if (!el) {
      if (idx >= steps.length - 1) closeTour(true);
      else setIdx((i) => i + 1);
    }
  }, [open, step, idx, steps.length]);

  // Position bubble + highlight
  useEffect(() => {
    if (!open) return;
    if (!step) return;

    const el = document.querySelector(step.selector) as HTMLElement | null;
    if (!el) return;

    // gently bring into view
    try {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch {}

    // highlight (non-destructive)
    clearHighlights();
    el.setAttribute("data-cc-tour-highlight", "1");
    el.style.boxShadow = "0 0 0 3px rgba(16,185,129,0.45)";
    el.style.borderRadius = "12px";

    const update = () => {
      const bubble = bubbleRef.current;
      if (!bubble) return;

      const targetRect = el.getBoundingClientRect();
      const bubbleRect = bubble.getBoundingClientRect();
      const placement = step.placement ?? "bottom";
      const offset = step.offset ?? 12;

      setPos(computePos(targetRect, bubbleRect, placement, offset));
    };

    const raf = requestAnimationFrame(update);
    const onScroll = () => update();
    const onResize = () => update();

    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
      clearHighlights();
    };
  }, [open, idx, step, steps]);

  if (!open || !step) return null;

  return (
    <>
      <div className="cc-tour-overlay" onClick={() => closeTour(false)} aria-hidden />

      <div
        ref={bubbleRef}
        className="cc-tour-bubble"
        style={{
          position: "fixed",
          top: pos?.top ?? 20,
          left: pos?.left ?? 20,
          width: 360,
          zIndex: 9999,
        }}
        role="dialog"
        aria-label="Guided tour"
      >
        <div className="cc-tour-header">
          <div>
            <div className="cc-tour-kicker">Guided overview</div>
            <div className="cc-tour-title">{step.title}</div>
          </div>

          <button className="cc-tour-x" onClick={() => closeTour(false)} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="cc-tour-body">{step.body}</div>

        <div className="cc-tour-footer">
          <div className="cc-tour-step">
            Step {idx + 1} of {steps.length}
          </div>

          <div className="cc-tour-actions">
            <button className="cc-tour-btn" onClick={() => closeTour(true)}>
              Skip
            </button>
            <button className="cc-tour-btn" onClick={back} disabled={idx === 0}>
              Back
            </button>
            <button className="cc-tour-btn primary" onClick={next}>
              {idx === steps.length - 1 ? "Done" : "Next"}
            </button>
          </div>
        </div>
      </div>

      <style jsx global>{`
        .cc-tour-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.05);
          z-index: 9998;
        }

        .cc-tour-bubble {
          background: #fff;
          border-radius: 16px;
          border: 1px solid #e6e6e6;
          padding: 16px;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
        }

        .cc-tour-header {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: flex-start;
        }

        .cc-tour-kicker {
          font-size: 12px;
          opacity: 0.65;
        }

        .cc-tour-title {
          font-size: 15px;
          font-weight: 900;
          margin-top: 4px;
          letter-spacing: -0.15px;
        }

        .cc-tour-x {
          border: 1px solid #eee;
          background: #fff;
          border-radius: 10px;
          padding: 6px 10px;
          cursor: pointer;
          font-weight: 900;
        }

        .cc-tour-body {
          margin-top: 10px;
          font-size: 14px;
          opacity: 0.85;
          line-height: 1.45;
          white-space: pre-wrap;
        }

        .cc-tour-footer {
          margin-top: 14px;
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: center;
          flex-wrap: wrap;
        }

        .cc-tour-step {
          font-size: 12px;
          opacity: 0.7;
          font-weight: 800;
        }

        .cc-tour-actions {
          display: flex;
          gap: 8px;
          align-items: center;
        }

        .cc-tour-btn {
          border: 1px solid #ddd;
          background: #fff;
          border-radius: 10px;
          padding: 8px 10px;
          cursor: pointer;
          font-weight: 900;
        }

        .cc-tour-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .cc-tour-btn.primary {
          border: 1px solid #111;
          background: #111;
          color: #fff;
        }
      `}</style>
    </>
  );
}