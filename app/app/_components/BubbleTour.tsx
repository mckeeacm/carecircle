"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

export type TourStep = {
  id: string;
  selector: string; // CSS selector for the element to attach to
  title: string;
  body: React.ReactNode;
  placement?: "top" | "bottom" | "left" | "right";
  offset?: number; // px
};

type Props = {
  tourId: string; // e.g. "member-onboarding-v1"
  steps: TourStep[];
  autoStart?: boolean;
  storageKey?: string; // override localStorage key if needed
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

  // Keep on screen with padding
  const pad = 12;
  top = clamp(top, pad, vh - bubbleRect.height - pad);
  left = clamp(left, pad, vw - bubbleRect.width - pad);

  return { top, left, placement };
}

export function BubbleTour({ tourId, steps, autoStart = true, storageKey }: Props) {
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

  function closeTour(done: boolean) {
    if (done) markDone();
    setOpen(false);
    setPos(null);
  }

  function next() {
    if (!steps.length) return closeTour(true);
    if (idx >= steps.length - 1) return closeTour(true);
    setIdx((i) => i + 1);
  }

  function back() {
    setIdx((i) => Math.max(0, i - 1));
  }

  // Auto-start once
  useEffect(() => {
    if (!autoStart) return;
    try {
      const done = localStorage.getItem(key) === "1";
      if (!done) setOpen(true);
    } catch {
      setOpen(true);
    }
  }, [autoStart, key]);

  // If step element missing, skip forward until we find one (or end)
  useEffect(() => {
    if (!open) return;
    if (!step) return;

    const el = document.querySelector(step.selector) as HTMLElement | null;
    if (!el) {
      // Try skipping; if at end -> done
      if (idx >= steps.length - 1) closeTour(true);
      else setIdx((i) => i + 1);
    }
  }, [open, step, idx, steps.length]);

  // Position bubble whenever open/idx changes, and on resize/scroll
  useEffect(() => {
    if (!open) return;
    if (!step) return;

    const update = () => {
      const el = document.querySelector(step.selector) as HTMLElement | null;
      const bubble = bubbleRef.current;
      if (!el || !bubble) return;

      const targetRect = el.getBoundingClientRect();

      // Subtle highlight: outline the target
      el.style.outline = "2px solid rgba(16,185,129,0.75)";
      el.style.outlineOffset = "3px";
      el.style.borderRadius = "12px";

      const bubbleRect = bubble.getBoundingClientRect();
      const placement = step.placement ?? "bottom";
      const offset = step.offset ?? 10;

      setPos(computePos(targetRect, bubbleRect, placement, offset));
    };

    // Ensure bubble has rendered before measuring
    const raf = requestAnimationFrame(update);

    const onScroll = () => update();
    const onResize = () => update();

    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);

      // remove outline from all step targets (clean)
      for (const s of steps) {
        const el = document.querySelector(s.selector) as HTMLElement | null;
        if (el) {
          el.style.outline = "";
          el.style.outlineOffset = "";
          el.style.borderRadius = "";
        }
      }
    };
  }, [open, idx, step, steps]);

  if (!open || !step) return null;

  return (
    <>
      {/* light overlay so bubbles read well but still “subtle” */}
      <div
        className="cc-tour-overlay"
        onClick={() => closeTour(false)}
        aria-hidden
      />

      <div
        ref={bubbleRef}
        className="cc-card cc-card-pad cc-tour-bubble"
        style={{
          position: "fixed",
          top: pos?.top ?? 20,
          left: pos?.left ?? 20,
          width: 320,
          zIndex: 9999,
        }}
        role="dialog"
        aria-label="Tour step"
      >
        <div className="cc-row-between" style={{ gap: 12 } as any}>
          <div>
            <div className="cc-kicker">Quick tour</div>
            <div className="cc-strong">{step.title}</div>
          </div>

          <button className="cc-btn" onClick={() => closeTour(false)}>
            ✕
          </button>
        </div>

        <div className="cc-subtle" style={{ marginTop: 10, whiteSpace: "pre-wrap" } as any}>
          {step.body}
        </div>

        <div className="cc-row-between" style={{ marginTop: 14 } as any}>
          <div className="cc-small">
            Step {idx + 1} of {steps.length}
          </div>

          <div className="cc-row">
            <button className="cc-btn" onClick={() => closeTour(true)}>
              Skip
            </button>
            <button className="cc-btn" onClick={back} disabled={idx === 0}>
              Back
            </button>
            <button className="cc-btn cc-btn-primary" onClick={next}>
              {idx === steps.length - 1 ? "Done" : "Next"}
            </button>
          </div>
        </div>
      </div>

      <style jsx global>{`
        .cc-tour-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.08);
          z-index: 9998;
        }
        .cc-tour-bubble {
          box-shadow: 0 14px 40px rgba(0,0,0,0.18);
        }
      `}</style>
    </>
  );
}
