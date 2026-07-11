"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Lenis from "lenis";

const pageTransitionDuration = 0.58;
const wheelThreshold = 24;
const wheelGestureGap = 40;
const touchThreshold = 44;

type SectionScroller = {
  goTo: (index: number) => void;
};

export type SnapSection = {
  id: string;
  title: string;
  theme: "light" | "dark";
};

export function usePageSnap(sections: SnapSection[], reducedMotion: boolean | null) {
  const [activeSection, setActiveSection] = useState(0);
  const activeSectionRef = useRef(0);
  const scrollerRef = useRef<SectionScroller | null>(null);

  const goToSection = useCallback(
    (requestedIndex: number) => {
      const index = Math.max(0, Math.min(requestedIndex, sections.length - 1));
      const target = document.getElementById(sections[index].id);

      if (scrollerRef.current) {
        scrollerRef.current.goTo(index);
        return;
      }

      activeSectionRef.current = index;
      setActiveSection(index);
      target?.scrollIntoView({
        behavior: reducedMotion ? "auto" : "smooth",
        block: "start",
      });
    },
    [reducedMotion, sections],
  );

  useEffect(() => {
    const root = document.documentElement;
    const elements = sections
      .map((section) => document.getElementById(section.id))
      .filter((element): element is HTMLElement => Boolean(element));

    root.classList.add("snap-controlled");

    const duration = reducedMotion ? 0.01 : pageTransitionDuration;
    const easing = (value: number) => 1 - Math.pow(1 - value, 5);
    const lenis = new Lenis({
      autoRaf: true,
      anchors: false,
      duration,
      easing,
      overscroll: false,
      smoothWheel: true,
      stopInertiaOnNavigate: true,
      virtualScroll: () => false,
    });

    let inputLocked = false;
    let navigationToken = 0;
    let wheelAccumulator = 0;
    let lastWheelAt = 0;
    let wheelGestureId = 0;
    let consumedWheelGestureId = -1;
    let touchStartX = 0;
    let touchStartY = 0;
    let touchCurrentY = 0;
    let trackingTouch = false;

    const commitSection = (index: number) => {
      const section = sections[index];
      if (!section) return;

      activeSectionRef.current = index;
      setActiveSection(index);
      window.history.replaceState(null, "", `#${section.id}`);
    };

    const navigateTo = (requestedIndex: number) => {
      const index = Math.max(0, Math.min(requestedIndex, elements.length - 1));
      const target = elements[index];
      if (!target) return;

      const token = ++navigationToken;
      inputLocked = true;
      wheelAccumulator = 0;
      commitSection(index);

      lenis.scrollTo(target, {
        duration,
        easing,
        force: true,
        lock: true,
        onComplete: () => {
          if (token === navigationToken) inputLocked = false;
        },
      });
    };

    const navigateByStep = (direction: -1 | 1) => {
      if (inputLocked) return;

      const currentIndex = activeSectionRef.current;
      const nextIndex = Math.max(0, Math.min(currentIndex + direction, elements.length - 1));
      if (nextIndex === currentIndex) return;
      navigateTo(nextIndex);
    };

    scrollerRef.current = { goTo: navigateTo };

    const handleWheel = (event: WheelEvent) => {
      if (event.ctrlKey) return;

      event.preventDefault();
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;

      const deltaMultiplier = event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? window.innerHeight
          : 1;

      const now = performance.now();
      const normalizedDelta = event.deltaY * deltaMultiplier;
      const eventGap = now - lastWheelAt;
      const startsNewGesture = eventGap > wheelGestureGap;

      if (startsNewGesture) {
        wheelGestureId += 1;
        wheelAccumulator = 0;
      }

      lastWheelAt = now;

      if (wheelGestureId === consumedWheelGestureId) return;

      wheelAccumulator += normalizedDelta;

      if (Math.abs(wheelAccumulator) < wheelThreshold) return;
      const direction = wheelAccumulator > 0 ? 1 : -1;
      wheelAccumulator = 0;
      consumedWheelGestureId = wheelGestureId;
      navigateByStep(direction);
    };

    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        trackingTouch = false;
        return;
      }

      const touch = event.touches[0];
      touchStartX = touch.clientX;
      touchStartY = touch.clientY;
      touchCurrentY = touch.clientY;
      trackingTouch = true;
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (!trackingTouch || event.touches.length !== 1) return;

      const touch = event.touches[0];
      const deltaX = touch.clientX - touchStartX;
      const deltaY = touch.clientY - touchStartY;
      touchCurrentY = touch.clientY;

      if (Math.abs(deltaY) > Math.abs(deltaX)) event.preventDefault();
    };

    const finishTouch = () => {
      if (!trackingTouch) return;
      trackingTouch = false;

      const distance = touchStartY - touchCurrentY;
      if (Math.abs(distance) < touchThreshold) return;
      navigateByStep(distance > 0 ? 1 : -1);
    };

    const cancelTouch = () => {
      trackingTouch = false;
    };

    const observer = new IntersectionObserver(
      (entries) => {
        if (inputLocked) return;

        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible) return;

        const index = elements.indexOf(visible.target as HTMLElement);
        if (index >= 0) commitSection(index);
      },
      { threshold: [0.55, 0.7, 0.9] },
    );

    elements.forEach((element) => observer.observe(element));

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("a, button, input, textarea, select, [contenteditable='true']")) return;

      if (["ArrowDown", "PageDown", " "].includes(event.key)) {
        event.preventDefault();
        navigateByStep(1);
        return;
      }

      if (["ArrowUp", "PageUp"].includes(event.key)) {
        event.preventDefault();
        navigateByStep(-1);
        return;
      }

      if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        navigateTo(event.key === "Home" ? 0 : sections.length - 1);
      }
    };

    window.addEventListener("wheel", handleWheel, { passive: false });
    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchmove", handleTouchMove, { passive: false });
    window.addEventListener("touchend", finishTouch, { passive: true });
    window.addEventListener("touchcancel", cancelTouch, { passive: true });
    window.addEventListener("keydown", handleKeyDown);

    const hashIndex = sections.findIndex((section) => `#${section.id}` === window.location.hash);
    const initialIndex = hashIndex >= 0 ? hashIndex : Math.round(window.scrollY / window.innerHeight);
    window.requestAnimationFrame(() => navigateTo(initialIndex));

    return () => {
      window.removeEventListener("wheel", handleWheel);
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", finishTouch);
      window.removeEventListener("touchcancel", cancelTouch);
      window.removeEventListener("keydown", handleKeyDown);
      observer.disconnect();
      lenis.destroy();
      scrollerRef.current = null;
      root.classList.remove("snap-controlled");
    };
  }, [reducedMotion, sections]);

  return {
    activeSection,
    goToSection,
  };
}
