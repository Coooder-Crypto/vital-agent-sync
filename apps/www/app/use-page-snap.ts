"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Lenis from "lenis";
import Snap from "lenis/snap";

const pageTransitionDuration = 0.58;

export type SnapSection = {
  id: string;
  title: string;
  theme: "light" | "dark";
};

export function usePageSnap(sections: SnapSection[], reducedMotion: boolean | null) {
  const [activeSection, setActiveSection] = useState(0);
  const activeSectionRef = useRef(0);
  const snapRef = useRef<Snap | null>(null);

  const goToSection = useCallback(
    (requestedIndex: number) => {
      const index = Math.max(0, Math.min(requestedIndex, sections.length - 1));
      const target = document.getElementById(sections[index].id);

      activeSectionRef.current = index;
      setActiveSection(index);

      if (snapRef.current) {
        snapRef.current.goTo(index);
      } else {
        target?.scrollIntoView({
          behavior: reducedMotion ? "auto" : "smooth",
          block: "start",
        });
      }
    },
    [reducedMotion, sections],
  );

  useEffect(() => {
    const root = document.documentElement;
    const elements = sections
      .map((section) => document.getElementById(section.id))
      .filter((element): element is HTMLElement => Boolean(element));
    const prefersNativeSnap =
      window.matchMedia("(pointer: coarse)").matches ||
      (navigator.maxTouchPoints > 0 && window.matchMedia("(hover: none)").matches);

    root.classList.add(prefersNativeSnap ? "snap-native" : "snap-lenis");

    let lenis: Lenis | null = null;
    let snap: Snap | null = null;
    let removeSnapElements: (() => void) | null = null;

    const commitSection = (index: number) => {
      const section = sections[index];
      if (!section) return;

      activeSectionRef.current = index;
      setActiveSection(index);
      window.history.replaceState(null, "", `#${section.id}`);
    };

    if (!prefersNativeSnap) {
      lenis = new Lenis({
        autoRaf: true,
        anchors: false,
        duration: reducedMotion ? 0.01 : pageTransitionDuration,
        easing: (value) => 1 - Math.pow(1 - value, 5),
        smoothWheel: true,
        stopInertiaOnNavigate: true,
      });

      snap = new Snap(lenis, {
        type: "lock",
        distanceThreshold: "100%",
        debounce: 35,
        duration: reducedMotion ? 0.01 : pageTransitionDuration,
        easing: (value) => 1 - Math.pow(1 - value, 5),
        onSnapStart: ({ index }) => {
          if (typeof index === "number") commitSection(index);
        },
      });

      removeSnapElements = snap.addElements(elements, { align: "start" });
      snapRef.current = snap;
    }

    const observer = new IntersectionObserver(
      (entries) => {
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

      let nextIndex: number | null = null;
      if (["ArrowDown", "PageDown", " "].includes(event.key)) nextIndex = activeSectionRef.current + 1;
      if (["ArrowUp", "PageUp"].includes(event.key)) nextIndex = activeSectionRef.current - 1;
      if (event.key === "Home") nextIndex = 0;
      if (event.key === "End") nextIndex = sections.length - 1;
      if (nextIndex === null) return;

      event.preventDefault();
      goToSection(nextIndex);
    };

    window.addEventListener("keydown", handleKeyDown);

    const hashIndex = sections.findIndex((section) => `#${section.id}` === window.location.hash);
    const initialIndex = hashIndex >= 0 ? hashIndex : Math.round(window.scrollY / window.innerHeight);
    window.requestAnimationFrame(() => goToSection(initialIndex));

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      observer.disconnect();
      snap?.destroy();
      removeSnapElements?.();
      lenis?.destroy();
      snapRef.current = null;
      root.classList.remove("snap-native", "snap-lenis");
    };
  }, [goToSection, reducedMotion, sections]);

  return {
    activeSection,
    goToSection,
  };
}
