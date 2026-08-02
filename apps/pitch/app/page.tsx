"use client";

import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Bot,
  BrainCircuit,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleUserRound,
  Clock3,
  Database,
  FileHeart,
  Fingerprint,
  HeartPulse,
  Maximize2,
  MessageSquareText,
  Minimize2,
  Network,
  NotebookTabs,
  Pause,
  Play,
  RefreshCcw,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Terminal,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type TouchEvent,
} from "react";
import appIcon from "../../ios/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png";

const STAGE_WIDTH = 1920;
const STAGE_HEIGHT = 1080;

const slides = [
  {
    id: "title",
    title: "Vital Agent Sync",
    notes: [
      "Vital Agent Sync 让 AI Agent 获得新鲜、经过授权的 Apple Health 上下文，同时让数据继续由用户控制。",
      "开场不要介绍功能清单。先让评委记住产品定位：Apple Health context. Private by design.",
    ],
  },
  {
    id: "problem",
    title: "AI 可以理解世界，却不知道今天的你",
    notes: [
      "用一个具体问题建立冲突：根据我昨晚的睡眠和今天的状态，我适合高强度训练吗？",
      "模型可能很强，但缺少当天、可验证的个人状态时，只能给出泛化答案。",
    ],
  },
  {
    id: "route",
    title: "一条由用户控制的 Context 路径",
    notes: [
      "Agent 不直接访问 HealthKit。iPhone 先生成摘要，再发送到用户自己的 Receiver。",
      "Receiver 通过 MCP 提供带范围和新鲜度的上下文。核心词是 Scoped、Fresh、Revocable。",
    ],
  },
  {
    id: "demo",
    title: "从连接到第一次回答",
    notes: [
      "播放 45–60 秒演示视频。视频应包含 Agent 发起连接、iPhone 确认权限、手动同步和 Agent 回答。",
      "不要在视频中暴露真实二维码、Token、服务器地址或可识别的健康信息。",
    ],
  },
  {
    id: "evidence",
    title: "Agent 得到证据，而不是 HealthKit 权限",
    notes: [
      "用真实 Agent 回答截图替换当前示例界面。",
      "重点指向更新时间、观测事实和推断边界。这一页证明产品不是单纯的数据转发。",
    ],
  },
  {
    id: "why",
    title: "我不想用交出所有数据，换取一个更懂我的 AI",
    notes: [
      "这里讲个人动机，不讲架构。Apple Health 已经记录了真实状态，模型也已经足够聪明，但两者之间缺少一条由用户控制的连接。",
      "补充一个真实触发场景，会比抽象观点更有说服力。",
    ],
  },
  {
    id: "scaling",
    title: "下一条 Scaling 轴，是 Context",
    notes: [
      "Context scaling 不是把 context window 做得更长，也不是把所有私人数据塞给模型。",
      "它是持续获得、筛选、验证和安全使用真实世界上下文的能力。",
    ],
  },
  {
    id: "ownership",
    title: "Context 应该扩展，但所有权不应转移",
    notes: [
      "更懂用户的 AI，不应该自动意味着平台拥有更多用户数据。",
      "用户决定数据来源、Agent 权限和撤销时机。Health 是这个架构的第一个压力测试。",
    ],
  },
  {
    id: "vision",
    title: "Health 是起点，不是边界",
    notes: [
      "收束到长期方向：从 Apple Health 走向用户拥有的 Agent Context 层。",
      "最后一句：我想验证的是，私人 Context 能否像模型能力一样扩展，同时仍然属于用户。",
    ],
  },
] as const;

type SlideProps = {
  active: boolean;
};

type VideoState = "loading" | "ready" | "missing";

export default function PitchDeck() {
  const prefersReducedMotion = useReducedMotion();
  const [activeSlide, setActiveSlide] = useState(0);
  const [direction, setDirection] = useState(1);
  const [deckScale, setDeckScale] = useState(1);
  const [notesOpen, setNotesOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const touchStartX = useRef<number | null>(null);

  const goToSlide = useCallback((nextIndex: number) => {
    const boundedIndex = Math.max(0, Math.min(slides.length - 1, nextIndex));
    setActiveSlide((currentIndex) => {
      if (boundedIndex === currentIndex) {
        return currentIndex;
      }
      setDirection(boundedIndex > currentIndex ? 1 : -1);
      return boundedIndex;
    });
  }, []);

  const goForward = useCallback(() => {
    setActiveSlide((currentIndex) => {
      const nextIndex = Math.min(slides.length - 1, currentIndex + 1);
      if (nextIndex !== currentIndex) {
        setDirection(1);
      }
      return nextIndex;
    });
  }, []);

  const goBack = useCallback(() => {
    setActiveSlide((currentIndex) => {
      const nextIndex = Math.max(0, currentIndex - 1);
      if (nextIndex !== currentIndex) {
        setDirection(-1);
      }
      return nextIndex;
    });
  }, []);

  const toggleFullscreen = useCallback(async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    await document.documentElement.requestFullscreen();
  }, []);

  useEffect(() => {
    const hashMatch = window.location.hash.match(/^#slide-(\d+)$/);
    if (hashMatch) {
      const requestedIndex = Number(hashMatch[1]) - 1;
      if (requestedIndex >= 0 && requestedIndex < slides.length) {
        setActiveSlide(requestedIndex);
      }
    }
  }, []);

  useEffect(() => {
    window.history.replaceState(null, "", `#slide-${activeSlide + 1}`);
  }, [activeSlide]);

  useEffect(() => {
    function updateScale() {
      const nextScale = Math.min(window.innerWidth / STAGE_WIDTH, window.innerHeight / STAGE_HEIGHT);
      setDeckScale(nextScale);
    }

    updateScale();
    window.addEventListener("resize", updateScale);
    return () => window.removeEventListener("resize", updateScale);
  }, []);

  useEffect(() => {
    function handleFullscreenChange() {
      setIsFullscreen(Boolean(document.fullscreenElement));
    }

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  useEffect(() => {
    function preventWheel(event: WheelEvent) {
      event.preventDefault();
    }

    window.addEventListener("wheel", preventWheel, { passive: false });
    return () => window.removeEventListener("wheel", preventWheel);
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.repeat) {
        return;
      }

      if (event.key === "ArrowRight" || event.key === "PageDown" || event.key === " ") {
        event.preventDefault();
        goForward();
        return;
      }

      if (event.key === "ArrowLeft" || event.key === "PageUp") {
        event.preventDefault();
        goBack();
        return;
      }

      if (event.key === "Home") {
        event.preventDefault();
        goToSlide(0);
        return;
      }

      if (event.key === "End") {
        event.preventDefault();
        goToSlide(slides.length - 1);
        return;
      }

      if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        void toggleFullscreen();
        return;
      }

      if (event.key.toLowerCase() === "n") {
        event.preventDefault();
        setNotesOpen((isOpen) => !isOpen);
        return;
      }

      if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        goToSlide(0);
        return;
      }

      if (event.key.toLowerCase() === "v" && activeSlide === 3) {
        event.preventDefault();
        window.dispatchEvent(new Event("pitch:toggle-video"));
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeSlide, goBack, goForward, goToSlide, toggleFullscreen]);

  function handleTouchStart(event: TouchEvent<HTMLDivElement>) {
    touchStartX.current = event.touches[0]?.clientX ?? null;
  }

  function handleTouchEnd(event: TouchEvent<HTMLDivElement>) {
    if (touchStartX.current === null) {
      return;
    }

    const endX = event.changedTouches[0]?.clientX ?? touchStartX.current;
    const deltaX = endX - touchStartX.current;
    touchStartX.current = null;

    if (Math.abs(deltaX) < 80) {
      return;
    }

    if (deltaX < 0) {
      goForward();
    } else {
      goBack();
    }
  }

  const stageStyle = {
    "--deck-scale": deckScale,
  } as CSSProperties;

  const currentSlide = slides[activeSlide];

  return (
    <main className="deck-viewport">
      <div
        className="deck-stage"
        style={stageStyle}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <AnimatePresence initial={false} custom={direction} mode="wait">
          <motion.div
            key={currentSlide.id}
            className="slide-transition"
            custom={direction}
            variants={prefersReducedMotion ? reducedSlideVariants : slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: prefersReducedMotion ? 0 : 0.34, ease: [0.22, 1, 0.36, 1] }}
          >
            <SlideRenderer index={activeSlide} />
          </motion.div>
        </AnimatePresence>

        <DeckChrome
          activeSlide={activeSlide}
          notesOpen={notesOpen}
          isFullscreen={isFullscreen}
          onBack={goBack}
          onForward={goForward}
          onToggleNotes={() => setNotesOpen((isOpen) => !isOpen)}
          onToggleFullscreen={() => void toggleFullscreen()}
        />

        <AnimatePresence>
          {notesOpen ? (
            <motion.aside
              className="speaker-notes"
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 24 }}
              transition={{ duration: 0.2 }}
              aria-label="Speaker notes"
            >
              <div className="notes-heading">
                <NotebookTabs size={25} />
                <span>演讲备注</span>
                <strong>{String(activeSlide + 1).padStart(2, "0")}</strong>
              </div>
              {currentSlide.notes.map((note) => (
                <p key={note}>{note}</p>
              ))}
            </motion.aside>
          ) : null}
        </AnimatePresence>
      </div>
    </main>
  );
}

function SlideRenderer({ index }: { index: number }) {
  switch (index) {
    case 0:
      return <TitleSlide active />;
    case 1:
      return <ProblemSlide active />;
    case 2:
      return <RouteSlide active />;
    case 3:
      return <DemoSlide active />;
    case 4:
      return <EvidenceSlide active />;
    case 5:
      return <WhySlide active />;
    case 6:
      return <ScalingSlide active />;
    case 7:
      return <OwnershipSlide active />;
    case 8:
      return <VisionSlide active />;
    default:
      return null;
  }
}

function DeckChrome({
  activeSlide,
  notesOpen,
  isFullscreen,
  onBack,
  onForward,
  onToggleNotes,
  onToggleFullscreen,
}: {
  activeSlide: number;
  notesOpen: boolean;
  isFullscreen: boolean;
  onBack: () => void;
  onForward: () => void;
  onToggleNotes: () => void;
  onToggleFullscreen: () => void;
}) {
  return (
    <>
      <div className="deck-progress" aria-hidden="true">
        <motion.span
          animate={{ scaleX: (activeSlide + 1) / slides.length }}
          transition={{ duration: 0.28, ease: "easeOut" }}
        />
      </div>

      {activeSlide === 0 ? (
        <div className="slide-counter" aria-live="polite">
          <strong>{String(activeSlide + 1).padStart(2, "0")}</strong>
          <span>/</span>
          <small>{String(slides.length).padStart(2, "0")}</small>
        </div>
      ) : null}

      <nav className="deck-controls" aria-label="Presentation controls">
        <button type="button" onClick={onBack} disabled={activeSlide === 0} aria-label="Previous slide" title="Previous slide">
          <ChevronLeft size={27} />
        </button>
        <button type="button" onClick={onForward} disabled={activeSlide === slides.length - 1} aria-label="Next slide" title="Next slide">
          <ChevronRight size={27} />
        </button>
        <button type="button" onClick={onToggleNotes} className={notesOpen ? "active" : ""} aria-label="Toggle speaker notes" title="Speaker notes (N)">
          <NotebookTabs size={23} />
        </button>
        <button type="button" onClick={onToggleFullscreen} aria-label="Toggle fullscreen" title="Fullscreen (F)">
          {isFullscreen ? <Minimize2 size={23} /> : <Maximize2 size={23} />}
        </button>
      </nav>
    </>
  );
}

function SlideShell({
  number,
  kicker,
  title,
  theme = "light",
  className = "",
  children,
}: {
  number: string;
  kicker: string;
  title?: string;
  theme?: "light" | "dark" | "sage";
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`slide slide-${theme} ${className}`}>
      <header className="slide-header">
        <div className="slide-brand">
          <img src={appIcon.src} alt="" />
          <span>Vital Agent Sync</span>
        </div>
        <p>
          <span>{number}</span>
          {kicker}
        </p>
      </header>
      {title ? <h2 className="slide-title">{title}</h2> : null}
      {children}
    </section>
  );
}

function TitleSlide(_: SlideProps) {
  return (
    <section className="slide title-slide">
      <div className="title-accent-column" aria-hidden="true">
        <span>PRIVATE</span>
        <span>SCOPED</span>
        <span>FRESH</span>
      </div>

      <div className="title-copy">
        <p className="title-kicker"><span /> Competition deck · Local Preview</p>
        <h1>Vital Agent<br /><strong>Sync</strong></h1>
        <p className="title-statement">Apple Health context.<br />Private by design.</p>
        <div className="title-meta">
          <span>USER-OWNED CONTEXT</span>
          <i />
          <span>MCP NATIVE</span>
          <i />
          <span>AGENT NEUTRAL</span>
        </div>
      </div>

      <div className="title-visual">
        <div className="title-icon-frame">
          <img src={appIcon.src} alt="Vital Agent Sync app icon" />
        </div>
        <div className="title-signal" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
        <p><HeartPulse size={25} /> HEALTH CONTEXT</p>
        <p><ShieldCheck size={25} /> USER CONTROL</p>
        <p><Bot size={25} /> AUTHORIZED AGENT</p>
      </div>
    </section>
  );
}

function ProblemSlide(_: SlideProps) {
  return (
    <SlideShell number="02" kicker="The missing layer" title="AI 可以理解世界，却不知道今天的你" className="problem-slide">
      <div className="problem-layout">
        <div className="problem-question">
          <MessageSquareText size={42} />
          <blockquote>“根据我昨晚的睡眠和今天的状态，<strong>我适合高强度训练吗？</strong>”</blockquote>
          <p>这是一个关于“我”的问题，不是一个关于健康知识的问题。</p>
        </div>

        <div className="generic-answer">
          <div className="answer-window-head">
            <span><Sparkles size={20} /> Generic AI</span>
            <small>NO PERSONAL CONTEXT</small>
          </div>
          <p>一般来说，是否适合高强度训练取决于睡眠、恢复、训练经验和身体感受……</p>
          <div className="missing-facts">
            <span><Clock3 size={20} /> 不知道数据是否最新</span>
            <span><HeartPulse size={20} /> 不知道昨晚睡了多久</span>
            <span><Fingerprint size={20} /> 无法验证个人状态</span>
          </div>
        </div>
      </div>
      <p className="problem-bottom-line"><ArrowRight size={25} /> 更强的推理，面对缺失的 Context，仍然只能给出泛化答案。</p>
    </SlideShell>
  );
}

const routeNodes = [
  { icon: Smartphone, label: "Apple Health", detail: "authorized on iPhone" },
  { icon: FileHeart, label: "Health summaries", detail: "compact, not raw samples" },
  { icon: Database, label: "Local receiver", detail: "user-owned SQLite" },
  { icon: Bot, label: "Authorized Agent", detail: "fresh context through MCP" },
];

function RouteSlide(_: SlideProps) {
  return (
    <SlideShell number="03" kicker="The product" title="一条由用户控制的 Context 路径" className="route-slide">
      <div className="route-diagram" aria-label="Apple Health to authorized Agent data route">
        <div className="route-line" aria-hidden="true">
          <motion.span
            animate={{ left: ["2%", "96%"] }}
            transition={{ duration: 3.4, repeat: Infinity, ease: "linear" }}
          />
        </div>
        {routeNodes.map((node, index) => {
          const Icon = node.icon;
          return (
            <motion.div
              className="route-node"
              key={node.label}
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.12 + index * 0.09, duration: 0.35 }}
            >
              <span className="route-node-icon"><Icon size={42} strokeWidth={1.8} /></span>
              <strong>{node.label}</strong>
              <small>{node.detail}</small>
            </motion.div>
          );
        })}
      </div>

      <div className="route-principles">
        <p><ShieldCheck size={27} /><span><strong>Scoped</strong>只暴露用户授权的摘要</span></p>
        <p><Clock3 size={27} /><span><strong>Fresh</strong>每次回答带数据新鲜度</span></p>
        <p><RefreshCcw size={27} /><span><strong>Revocable</strong>权限可以审计和撤销</span></p>
      </div>
      <p className="route-caption">Agent 不直接访问 HealthKit。Context 先经过授权、摘要和本地边界。</p>
    </SlideShell>
  );
}

function DemoSlide(_: SlideProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [videoState, setVideoState] = useState<VideoState>("loading");
  const [isPlaying, setIsPlaying] = useState(false);

  const toggleVideo = useCallback(() => {
    const video = videoRef.current;
    if (!video || videoState !== "ready") {
      return;
    }

    if (video.paused) {
      void video.play();
    } else {
      video.pause();
    }
  }, [videoState]);

  useEffect(() => {
    window.addEventListener("pitch:toggle-video", toggleVideo);
    return () => window.removeEventListener("pitch:toggle-video", toggleVideo);
  }, [toggleVideo]);

  return (
    <SlideShell number="04" kicker="Product demo" title="从连接到第一次回答" theme="dark" className="demo-slide">
      <div className="demo-frame">
        <video
          ref={videoRef}
          src="/media/demo.mp4"
          playsInline
          preload="metadata"
          onLoadedData={() => setVideoState("ready")}
          onError={() => setVideoState("missing")}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => setIsPlaying(false)}
          aria-label="Vital Agent Sync product demo"
        />

        {videoState !== "ready" ? (
          <div className="demo-placeholder">
            <img src={appIcon.src} alt="" />
            <span><Play size={42} fill="currentColor" /></span>
            <h3>演示视频</h3>
            <p>Connect → Pair → Sync → Ask</p>
            <small>{videoState === "missing" ? "视频素材待加入" : "正在检查本地视频"}</small>
          </div>
        ) : (
          <button type="button" className="video-toggle" onClick={toggleVideo} aria-label={isPlaying ? "Pause demo video" : "Play demo video"}>
            {isPlaying ? <Pause size={35} fill="currentColor" /> : <Play size={35} fill="currentColor" />}
          </button>
        )}

        <div className="demo-sequence" aria-hidden="true">
          <span className="active">01 CONNECT</span>
          <span>02 PAIR</span>
          <span>03 SYNC</span>
          <span>04 ASK</span>
        </div>
      </div>
      <p className="demo-hint"><Play size={21} /> 点击画面或按 V 播放 / 暂停</p>
    </SlideShell>
  );
}

function EvidenceSlide(_: SlideProps) {
  return (
    <SlideShell number="05" kicker="What the demo proves" title="Agent 得到证据，而不是 HealthKit 权限" className="evidence-slide">
      <div className="evidence-layout">
        <div className="agent-capture">
          <div className="capture-head">
            <span><Bot size={23} /> Agent response</span>
            <small>ILLUSTRATIVE OUTPUT</small>
          </div>
          <p className="capture-question">How ready am I for a hard workout today?</p>
          <div className="capture-answer">
            <p>你的恢复信号整体稳定，但昨晚睡眠比七日均值少了 38 分钟。建议今天先保持中等强度，并在热身后重新评估身体感受。</p>
            <div className="capture-facts">
              <span>Sleep <strong>6h 42m</strong></span>
              <span>HRV <strong>42 ms</strong></span>
              <span>Resting HR <strong>61</strong></span>
            </div>
          </div>
          <footer>
            <span><Clock3 size={19} /> Synced 2 min ago</span>
            <span><ShieldCheck size={19} /> health.daily.read</span>
          </footer>
        </div>

        <div className="evidence-notes">
          <EvidenceNote number="01" title="Freshness" body="回答明确说明数据更新时间。" />
          <EvidenceNote number="02" title="Observed facts" body="健康事实来自授权后的 MCP 输出。" />
          <EvidenceNote number="03" title="Inference boundary" body="模型区分观测、推断与限制。" />
        </div>
      </div>
      <p className="evidence-thesis">Fresh context. Explicit scope. No direct HealthKit access.</p>
    </SlideShell>
  );
}

function EvidenceNote({ number, title, body }: { number: string; title: string; body: string }) {
  return (
    <div className="evidence-note">
      <span>{number}</span>
      <div>
        <strong>{title}</strong>
        <p>{body}</p>
      </div>
    </div>
  );
}

function WhySlide(_: SlideProps) {
  return (
    <SlideShell number="06" kicker="Why I built this" theme="dark" className="why-slide">
      <div className="why-layout">
        <blockquote>我不想用<strong>交出所有数据</strong>，换取一个更懂我的 AI。</blockquote>

        <div className="why-sequence">
          <div>
            <span><HeartPulse size={32} /> 01</span>
            <strong>Apple Health</strong>
            <p>已经记录了真实、连续的个人状态。</p>
          </div>
          <ArrowRight size={34} />
          <div>
            <span><BrainCircuit size={32} /> 02</span>
            <strong>Better models</strong>
            <p>已经具备分析和推理这些信息的能力。</p>
          </div>
          <ArrowRight size={34} />
          <div className="missing-link">
            <span><Network size={32} /> 03</span>
            <strong>The missing link</strong>
            <p>缺少一条持续、安全、由用户控制的连接。</p>
          </div>
        </div>
      </div>
      <p className="why-footer">The problem was not intelligence. It was access to trustworthy context.</p>
    </SlideShell>
  );
}

const modelScaling = ["Reasoning", "Multimodality", "Tool use", "Capability"];
const contextScaling = ["Identity", "Memory", "Real-world state", "Freshness", "Permission"];

function ScalingSlide(_: SlideProps) {
  return (
    <SlideShell number="07" kicker="My thesis" title="下一条 Scaling 轴，是 Context" className="scaling-slide">
      <div className="scaling-layout">
        <div className="scaling-column model-column">
          <span className="scaling-index">01</span>
          <h3>MODEL<br />SCALING</h3>
          <div className="scaling-terms">
            {modelScaling.map((term) => <span key={term}>{term}</span>)}
          </div>
          <p>提升智能的能力上限</p>
        </div>

        <div className="scaling-divider" aria-hidden="true">
          <BrainCircuit size={48} />
          <span />
          <CircleUserRound size={48} />
        </div>

        <div className="scaling-column context-column">
          <span className="scaling-index">02</span>
          <h3>CONTEXT<br />SCALING</h3>
          <div className="scaling-terms">
            {contextScaling.map((term) => <span key={term}>{term}</span>)}
          </div>
          <p>让智能进入真实世界</p>
        </div>
      </div>

      <div className="scaling-statement">
        <p>Model scaling determines what AI can do.</p>
        <strong>Context scaling determines whether it can do it for me.</strong>
      </div>
      <small className="scaling-definition">Context scaling ≠ a longer context window. It is the ability to acquire, verify, retrieve and safely use relevant context over time.</small>
    </SlideShell>
  );
}

function OwnershipSlide(_: SlideProps) {
  return (
    <SlideShell number="08" kicker="The principle" title="Context 应该扩展，但所有权不应转移" theme="sage" className="ownership-slide">
      <div className="ownership-flow">
        <div className="ownership-group sources-group">
          <p>PERSONAL DATA SOURCES</p>
          <div>
            <span><HeartPulse size={35} /> Health</span>
            <span><CalendarDays size={35} /> Calendar</span>
            <span><MessageSquareText size={35} /> Feedback</span>
          </div>
        </div>

        <div className="ownership-arrow"><ArrowRight size={42} /></div>

        <div className="context-core">
          <img src={appIcon.src} alt="" />
          <ShieldCheck size={53} />
          <strong>User-owned<br />context layer</strong>
          <small>scope · freshness · audit · revoke</small>
        </div>

        <div className="ownership-arrow"><ArrowRight size={42} /></div>

        <div className="ownership-group agents-group">
          <p>AUTHORIZED AGENTS</p>
          <div>
            <span><Bot size={35} /> WorkBuddy</span>
            <span><Terminal size={35} /> OpenClaw</span>
            <span><Sparkles size={35} /> Any MCP Agent</span>
          </div>
        </div>
      </div>

      <div className="ownership-principles">
        <span><Check size={22} /> 用户决定接入什么</span>
        <span><Check size={22} /> 每个 Agent 获得有限权限</span>
        <span><Check size={22} /> Context 带来源和新鲜度</span>
        <span><Check size={22} /> 用户随时审计和撤销</span>
      </div>
    </SlideShell>
  );
}

function VisionSlide(_: SlideProps) {
  return (
    <SlideShell number="09" kicker="The direction" theme="dark" className="vision-slide">
      <div className="vision-layout">
        <div className="vision-copy">
          <h2>Health 是起点，<br /><strong>不是边界。</strong></h2>
          <p>从一条可验证的 Apple Health 路径开始，走向用户拥有的 Agent Context 层。</p>
        </div>

        <div className="vision-path">
          <div>
            <span>NOW</span>
            <HeartPulse size={38} />
            <strong>Apple Health</strong>
            <p>一台 iPhone · 一条授权路径</p>
          </div>
          <ArrowRight size={39} />
          <div>
            <span>NEXT</span>
            <Network size={38} />
            <strong>Personal context</strong>
            <p>更多数据源 · 更多授权 Agent</p>
          </div>
        </div>
      </div>

      <blockquote className="vision-quote">
        “我想验证的是：私人 Context 能否像模型能力一样扩展，<strong>同时仍然属于用户。</strong>”
      </blockquote>

      <div className="vision-signoff">
        <img src={appIcon.src} alt="" />
        <span>Vital Agent Sync</span>
        <small>PRIVATE APPLE HEALTH BRIDGE</small>
      </div>
    </SlideShell>
  );
}

const slideVariants = {
  enter: (direction: number) => ({
    opacity: 0,
    x: direction > 0 ? 110 : -110,
  }),
  center: {
    opacity: 1,
    x: 0,
  },
  exit: (direction: number) => ({
    opacity: 0,
    x: direction > 0 ? -70 : 70,
  }),
};

const reducedSlideVariants = {
  enter: { opacity: 1, x: 0 },
  center: { opacity: 1, x: 0 },
  exit: { opacity: 1, x: 0 },
};
