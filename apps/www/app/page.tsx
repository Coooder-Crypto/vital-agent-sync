"use client";

import Image from "next/image";
import { useEffect, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  ArrowDown,
  ArrowRight,
  Bot,
  Check,
  Cloud,
  Code2,
  Copy,
  Database,
  ExternalLink,
  Fingerprint,
  Github,
  Menu,
  QrCode,
  RefreshCw,
  Server,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Terminal,
  X,
  Zap,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import appIcon from "../../../Resources/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png";
import { usePageSnap, type SnapSection } from "./use-page-snap";

const installCommand = "npx -y vitalmcp setup";
const githubUrl = "https://github.com/Coooder-Crypto/health-link";

const sections: SnapSection[] = [
  { id: "overview", title: "Overview", theme: "light" },
  { id: "first-run", title: "First run", theme: "light" },
  { id: "agent-answer", title: "Agent answer", theme: "light" },
  { id: "privacy", title: "Privacy boundary", theme: "dark" },
  { id: "deploy", title: "Deployment", theme: "light" },
  { id: "product", title: "Product", theme: "light" },
  { id: "builders", title: "MCP tools", theme: "light" },
  { id: "install-now", title: "Install", theme: "dark" },
];

const headerLinks = [
  { index: 1, label: "How it works" },
  { index: 3, label: "Privacy" },
  { index: 4, label: "Deploy" },
  { index: 6, label: "Builders" },
];

const flowSteps = [
  {
    number: "01",
    label: "Install",
    title: "Start the local runtime.",
    body: "One published npm command starts the LAN receiver and prepares standard MCP config for your Agent.",
    icon: Terminal,
  },
  {
    number: "02",
    label: "Pair",
    title: "Scan one onboarding code.",
    body: "Your iPhone saves the receiver address and scoped device credential from one short-lived pairing QR.",
    icon: QrCode,
  },
  {
    number: "03",
    label: "Sync",
    title: "Sync over your trusted network.",
    body: "Use LAN by default, or your authorized Tailscale network when you need private remote access.",
    icon: Server,
  },
  {
    number: "04",
    label: "Ask",
    title: "Your agent gets fresh, scoped context.",
    body: "Decryption and MCP queries happen locally, with freshness and inference boundaries attached.",
    icon: Sparkles,
  },
];

const questions = [
  {
    label: "Today",
    question: "How ready am I for a hard workout today?",
    answer:
      "Your recovery signals look steady, but sleep was 38 minutes below your 7-day average. Keep intensity moderate and reassess after your warm-up.",
    facts: ["Sleep 6h 42m", "HRV 42 ms", "Resting HR 61"],
  },
  {
    label: "Sleep",
    question: "What changed in my sleep this week?",
    answer:
      "Sleep duration improved across the last four nights, while bedtime moved 51 minutes later. Your strongest recovery days followed earlier bedtimes.",
    facts: ["7-day avg 7h 08m", "+34m vs last week", "6 of 7 days synced"],
  },
  {
    label: "Training",
    question: "Summarize my training load before the weekend.",
    answer:
      "You logged three workouts and 142 exercise minutes. Load is above last week, with no matching drop in HRV or rise in resting heart rate.",
    facts: ["3 workouts", "142 active min", "+12% weekly load"],
  },
];

const modes = [
  {
    label: "LAN",
    eyebrow: "Local Preview default",
    icon: Database,
    title: "Start on the network you trust.",
    body: "Send summaries directly from iPhone to the VitalMCP receiver on your Mac or home server.",
    bullets: ["No hosted service", "No account or payment", "Same local MCP tools"],
    path: ["iPhone", "Trusted LAN", "Your machine"],
  },
  {
    label: "Tailscale",
    eyebrow: "Optional private remote",
    icon: Server,
    title: "Reach home without going public.",
    body: "Use your own Tailscale account and authorized tailnet when the iPhone is away from the receiver's LAN.",
    bullets: ["Tailscale app on both devices", "Authorized tailnet required", "No public receiver URL"],
    path: ["iPhone", "Your tailnet", "Your machine"],
  },
  {
    label: "Hosted relay",
    eyebrow: "Future experiment",
    icon: Cloud,
    title: "Outside Local Preview.",
    body: "The encrypted relay protocol remains under development, but hosted delivery is not available or recommended for Local Preview onboarding.",
    bullets: ["Not required for setup", "No current hosted CTA", "Protocol work remains isolated"],
    path: ["iPhone", "Future relay", "Your machine"],
  },
];

const tools = [
  ["get_personal_context", "Daily state and readiness"],
  ["get_sleep_trend", "Sleep duration and continuity"],
  ["get_workout_load", "Recent activity and strain"],
  ["get_recovery_signals", "HRV, heart rate, sleep, and freshness"],
];

export default function Home() {
  const reducedMotion = useReducedMotion();
  const { activeSection, goToSection } = usePageSnap(sections, reducedMotion);
  const [copied, setCopied] = useState(false);

  async function copyInstallCommand() {
    let didCopy = false;

    try {
      await navigator.clipboard.writeText(installCommand);
      didCopy = true;
    } catch {
      const input = document.createElement("textarea");
      input.value = installCommand;
      input.setAttribute("readonly", "");
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      didCopy = document.execCommand("copy");
      input.remove();
    }

    if (didCopy) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    }
  }

  return (
    <>
      <PageHeader active={activeSection} onNavigate={goToSection} />
      <main className="snap-site">
        <HeroPage copied={copied} onCopy={copyInstallCommand} onNavigate={goToSection} />
        <FirstRunPage />
        <AgentAnswerPage />
        <PrivacyPage />
        <DeployPage />
        <ProductPage />
        <BuildersPage onNavigate={goToSection} />
        <FinalPage copied={copied} onCopy={copyInstallCommand} onNavigate={goToSection} />
      </main>
    </>
  );
}

function PageHeader({ active, onNavigate }: { active: number; onNavigate: (index: number) => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const section = sections[active];
  const isDark = section.theme === "dark";

  useEffect(() => setMenuOpen(false), [active]);

  function navigate(index: number) {
    setMenuOpen(false);
    onNavigate(index);
  }

  return (
    <>
      <header className={`global-header ${isDark ? "header-dark" : "header-light"}`}>
        <div className="header-inner page-width">
          <button type="button" className="header-brand" onClick={() => navigate(0)} aria-label="Go to VitalMCP overview">
            <BrandMark className="header-mark" priority />
            <span className="header-brand-copy"><strong>VitalMCP</strong><small>Private health context</small></span>
          </button>

          <nav className="header-nav" aria-label="Primary navigation">
            {headerLinks.map((item) => (
              <button
                key={item.label}
                type="button"
                className={active === item.index ? "active" : ""}
                onClick={() => navigate(item.index)}
              >
                {item.label}
              </button>
            ))}
          </nav>

          <div className="header-actions">
            <a className="header-github" href={githubUrl} target="_blank" rel="noreferrer" aria-label="VitalMCP on GitHub" title="GitHub">
              <Github size={18} />
            </a>
            <button type="button" className="header-install" onClick={() => navigate(sections.length - 1)}>
              <Terminal size={16} /><span>Start Local Preview</span>
            </button>
            <button type="button" className="header-menu-button" onClick={() => setMenuOpen((open) => !open)} aria-expanded={menuOpen} aria-label={menuOpen ? "Close section menu" : "Open section menu"}>
              {menuOpen ? <X size={19} /> : <Menu size={19} />}
            </button>
          </div>
        </div>

        <AnimatePresence>
          {menuOpen && (
            <motion.div className="header-mobile-menu" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
              <div className="mobile-menu-grid">
                {sections.map((item, index) => (
                  <button key={item.id} type="button" className={index === active ? "active" : ""} onClick={() => navigate(index)}>
                    <span>{String(index + 1).padStart(2, "0")}</span>{item.title}
                  </button>
                ))}
              </div>
              <a href={githubUrl} target="_blank" rel="noreferrer"><Github size={17} /> View source on GitHub <ExternalLink size={14} /></a>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      <nav
        className={`page-rail ${isDark ? "rail-dark" : "rail-light"}`}
        aria-label={`Section ${active + 1} of ${sections.length}: ${section.title}`}
      >
        <span className="page-rail-current" aria-live="polite">{section.title}</span>
        <div className="page-rail-shell">
          <span className="page-rail-index">{String(active + 1).padStart(2, "0")}</span>
          <div className="page-rail-track">
            <motion.span
              className="page-rail-fill"
              initial={false}
              animate={{ scaleY: (active + 1) / sections.length }}
              transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            />
            {sections.map((item, index) => (
              <button
                key={item.id}
                type="button"
                className={index === active ? "active" : ""}
                onClick={() => navigate(index)}
                aria-label={`Go to ${item.title}`}
                aria-current={index === active ? "page" : undefined}
              >
                <span className="page-rail-tooltip">{item.title}</span>
              </button>
            ))}
          </div>
          <span className="page-rail-total">{String(sections.length).padStart(2, "0")}</span>
        </div>
      </nav>
    </>
  );
}

function HeroPage({ copied, onCopy, onNavigate }: { copied: boolean; onCopy: () => void; onNavigate: (index: number) => void }) {
  const reducedMotion = useReducedMotion();
  const item = { hidden: { opacity: 0, y: reducedMotion ? 0 : 16 }, show: { opacity: 1, y: 0 } };

  return (
    <SnapPage id="overview" className="hero-page">
      <div className="hero-rules" aria-hidden="true"><i /><i /><i /><i /></div>
      <div className="hero-code" aria-hidden="true">HL/01</div>
      <motion.div className="page-width hero-page-inner" initial={false} animate="show" variants={{ show: { transition: { staggerChildren: reducedMotion ? 0 : 0.07 } } }}>
        <div className="hero-main">
          <motion.p className="page-kicker" variants={item}><span /> VitalMCP for MCP agents</motion.p>
          <motion.h1 variants={item}>Apple Health context.<strong>Private by design.</strong></motion.h1>
          <motion.p className="hero-lede" variants={item}>Fresh Apple Health summaries become scoped context for your agent. Start directly over trusted LAN; add your own Tailscale network for private remote access.</motion.p>
          <motion.div className="hero-actions" variants={item}>
            <button type="button" className="button button-dark" onClick={() => onNavigate(7)}>Start Local Preview <ArrowRight size={17} /></button>
            <button type="button" className="text-button" onClick={() => onNavigate(1)}>See the private route <ArrowDown size={16} /></button>
          </motion.div>
          <motion.div variants={item}><CommandBar copied={copied} onCopy={onCopy} /></motion.div>
        </div>

        <motion.div className="hero-route" variants={item} aria-label="Local route from Apple Health to the VitalMCP runtime">
          <RouteNode icon={Smartphone} label="Apple Health" detail="summarized on iPhone" />
          <RouteLine delay={false} />
          <RouteNode icon={Server} label="LAN / Tailscale" detail="your private network" />
          <RouteLine delay />
          <RouteNode icon={Database} label="Local runtime" detail="SQLite and MCP" />
        </motion.div>
      </motion.div>
      <div className="hero-trust page-width">
        <span><Database size={15} /> User-owned receiver</span>
        <span><Code2 size={15} /> MCP native</span>
        <span><Server size={15} /> LAN first</span>
        <span><Fingerprint size={15} /> Source controlled</span>
      </div>
    </SnapPage>
  );
}

function FirstRunPage() {
  const [active, setActive] = useState(0);
  const reducedMotion = useReducedMotion();
  const step = flowSteps[active];

  return (
    <SnapPage id="first-run" className="flow-page">
      <div className="page-width flow-page-inner">
        <div className="page-title-row">
          <PageTitle kicker="One guided first run" title="Install to answer, in four verified steps." />
          <div className="page-stats"><span><strong>1</strong> Command</span><span><strong>1</strong> Scan</span><span><strong>0</strong> Hosted services</span></div>
        </div>

        <div className="flow-workbench">
          <div className="flow-tabs" role="tablist" aria-label="VitalMCP setup steps">
            {flowSteps.map((item, index) => (
              <button key={item.number} type="button" role="tab" aria-selected={active === index} onClick={() => setActive(index)}>
                {active === index && <motion.i layoutId="flow-tab" />}
                <span>{item.number}</span><item.icon size={17} /><div><small>{item.label}</small><strong>{item.title}</strong></div>
              </button>
            ))}
          </div>
          <div className="flow-window">
            <div className="window-head"><span>LOCAL SETUP / VITALMCP</span><span><i /> {step.label.toUpperCase()}</span></div>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div className="flow-window-body" key={active} initial={{ opacity: 0, y: reducedMotion ? 0 : 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reducedMotion ? 0 : -8 }} transition={{ duration: reducedMotion ? 0 : 0.25 }}>
                <div className="flow-copy"><p>{step.number} / 04</p><h3>{step.title}</h3><span>{step.body}</span></div>
                <div className="flow-visual"><FlowVisual index={active} /></div>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </SnapPage>
  );
}

function FlowVisual({ index }: { index: number }) {
  if (index === 0) {
    return (
      <div className="terminal-visual">
        <p><span>TERMINAL</span>npx -y vitalmcp setup</p>
        <p className="agent"><span>VITALMCP</span><Check size={15} /> Local runtime ready</p>
        <div><span><Check size={14} /> Runtime ready</span><span><Check size={14} /> Keys created</span><span><RefreshCw size={14} /> Awaiting iPhone</span></div>
      </div>
    );
  }

  if (index === 1) {
    return (
      <div className="pair-visual">
        <div className="qr-shell"><QrCode size={108} strokeWidth={1.2} /><i /></div>
        <span>VERIFY ON BOTH DEVICES</span><code>9A:2F:71:C4</code>
      </div>
    );
  }

  if (index === 2) {
    return (
      <div className="relay-visual">
        <RoutePoint icon={Smartphone} label="iPhone" />
        <div className="encrypted-hop"><span><ShieldCheck size={13} /></span><i /></div>
        <RoutePoint icon={Server} label="Trusted LAN" muted />
        <div className="encrypted-hop"><span><ShieldCheck size={13} /></span><i /></div>
        <RoutePoint icon={Database} label="Receiver" />
        <code>192.168.x.x:8787</code>
      </div>
    );
  }

  return (
    <div className="answer-visual">
      <p><span>YOU</span>How ready am I for a hard workout today?</p>
      <p><span>VITALMCP</span>Your recovery looks steady. Keep today&apos;s intensity moderate.</p>
      <div><span>Sleep 6h 42m</span><span>HRV 42 ms</span><span>Fresh 4m</span></div>
      <small><ShieldCheck size={14} /> Observed data separated from inference</small>
    </div>
  );
}

function AgentAnswerPage() {
  const [active, setActive] = useState(0);
  const reducedMotion = useReducedMotion();
  const question = questions[active];

  return (
    <SnapPage id="agent-answer" className="agent-page">
      <div className="page-width agent-page-inner">
        <div className="agent-copy">
          <PageTitle kicker="Useful on day one" title="Ask naturally. Keep the evidence visible." body="VitalMCP checks freshness, returns only the context your Agent requests, and marks the line between observed data and inference." />
          <div className="segmented-tabs" role="tablist" aria-label="Health question examples">
            {questions.map((item, index) => <button key={item.label} type="button" role="tab" aria-selected={active === index} onClick={() => setActive(index)}>{item.label}</button>)}
          </div>
        </div>

        <div className="agent-console">
          <div className="window-head"><span><Bot size={16} /> MCP AGENT / VITALMCP</span><span><i /> FRESH DATA</span></div>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div className="console-body" key={active} initial={{ opacity: 0, y: reducedMotion ? 0 : 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reducedMotion ? 0 : -8 }} transition={{ duration: reducedMotion ? 0 : 0.24 }} aria-live="polite">
              <div className="console-line"><span>YOU</span><p>{question.question}</p></div>
              <div className="console-line answer"><span>VITALMCP</span><p>{question.answer}</p></div>
              <div className="fact-row">{question.facts.map((fact) => <span key={fact}>{fact}</span>)}</div>
            </motion.div>
          </AnimatePresence>
          <div className="console-foot"><span><ShieldCheck size={14} /> Observed data separated from inference</span><span>synced 4m ago</span></div>
        </div>
      </div>
    </SnapPage>
  );
}

function PrivacyPage() {
  const ledger: [LucideIcon, string, string][] = [
    [Smartphone, "iPhone", "Creates compact Health summaries"],
    [Server, "Private network", "Trusted LAN or your authorized tailnet"],
    [Database, "Your machine", "Keeps SQLite and serves MCP"],
    [Bot, "Your agent", "Gets scoped summaries only"],
  ];

  return (
    <SnapPage id="privacy" className="privacy-page">
      <div className="privacy-word" aria-hidden="true">LOCAL FIRST</div>
      <div className="page-width privacy-page-inner">
        <div className="privacy-copy">
          <PageTitle kicker="The Local Preview boundary" title="Your receiver. Your network. Your data." body="LAN sends directly to your machine. Optional Tailscale uses your authorized tailnet. No VitalMCP-hosted service sits in the default route." light />
          <div className="privacy-proof"><Database size={18} /><span><strong>Health context location</strong>Your machine, always</span></div>
        </div>
        <div className="privacy-ledger">
          {ledger.map(([Icon, label, value], index) => <div className="ledger-row" key={label}><span>{String(index + 1).padStart(2, "0")}</span><i><Icon size={18} /></i><strong>{label}</strong><p>{value}</p></div>)}
        </div>
      </div>
    </SnapPage>
  );
}

function DeployPage() {
  const [active, setActive] = useState(0);
  const reducedMotion = useReducedMotion();
  const mode = modes[active];

  return (
    <SnapPage id="deploy" className="deploy-page">
      <div className="page-width deploy-page-inner">
        <div className="page-title-row compact"><PageTitle kicker="Local Preview routes" title="LAN first. Tailscale when you roam." body="Change the private network route without changing what your agent sees. Hosted relay remains a future experiment." /></div>
        <div className="deploy-tabs" role="tablist" aria-label="Deployment mode">
          {modes.map((item, index) => (
            <button key={item.label} type="button" role="tab" aria-selected={active === index} onClick={() => setActive(index)}>
              {active === index && <motion.i layoutId="deploy-tab" transition={{ duration: reducedMotion ? 0 : 0.24 }} />}
              <item.icon size={17} /><span>{item.label}</span>
            </button>
          ))}
        </div>
        <div className="deploy-panel">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div className="deploy-copy" key={active} initial={{ opacity: 0, x: reducedMotion ? 0 : 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: reducedMotion ? 0 : -10 }} transition={{ duration: reducedMotion ? 0 : 0.22 }}>
              <p>{mode.eyebrow}</p><h3>{mode.title}</h3><span>{mode.body}</span>
              <ul>{mode.bullets.map((bullet) => <li key={bullet}><Check size={14} />{bullet}</li>)}</ul>
            </motion.div>
          </AnimatePresence>
          <div className="deploy-route">
            {mode.path.map((point, index) => <div key={point}><span>{String(index + 1).padStart(2, "0")}</span><strong>{point}</strong>{index < mode.path.length - 1 && <i />}</div>)}
            <p><ShieldCheck size={15} /> Health context remains on your machine</p>
          </div>
        </div>
      </div>
    </SnapPage>
  );
}

function ProductPage() {
  return (
    <SnapPage id="product" className="product-page">
      <div className="page-width product-page-inner">
        <div className="product-copy">
          <PageTitle kicker="Product surface" title="A calm interface for a sensitive data path." body="Live iPhone and agent captures will replace these frames during beta." />
          <div className="product-caption"><span>PRODUCT FILM / 00:45</span><strong>Install. Scan. Ask.</strong><p>Capture slot reserved for the beta first-run flow.</p></div>
        </div>
        <div className="product-composite">
          <div className="report-frame">
            <div className="window-head"><span>VITALMCP / CONTEXT</span><span><i /> LOCAL</span></div>
            <div className="report-body">
              <div className="report-heading"><span>FRIDAY, JUL 11</span><h3>Morning context</h3></div>
              <div className="report-score"><strong>82</strong><span>Recovery<br />steady</span></div>
              <div className="report-chart" aria-hidden="true">{[48, 58, 54, 67, 63, 78, 72, 84, 79, 88, 82].map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}</div>
              <div className="report-metrics"><span><small>SLEEP</small><strong>6h 42m</strong><em>-38m avg</em></span><span><small>HRV</small><strong>42 ms</strong><em>steady</em></span><span><small>LOAD</small><strong>Moderate</strong><em>3 workouts</em></span></div>
            </div>
          </div>
          <div className="phone-frame">
            <i className="phone-island" />
            <div className="phone-head"><BrandMark className="phone-brand-mark" /><strong>VitalMCP</strong><small>Secure</small></div>
            <div className="phone-sync"><span><Check size={28} /></span><h3>Sync complete</h3><p>Today&apos;s summary is stored in your local runtime and ready for your agent.</p></div>
            <div className="phone-meta"><span><small>ROUTE</small><strong>Trusted LAN</strong></span><span><small>UPDATED</small><strong>Just now</strong></span></div>
          </div>
        </div>
      </div>
    </SnapPage>
  );
}

function BuildersPage({ onNavigate }: { onNavigate: (index: number) => void }) {
  return (
    <SnapPage id="builders" className="builders-page">
      <div className="page-width builders-page-inner">
        <div className="builders-copy">
          <PageTitle kicker="Portable by design" title="Agent-neutral. MCP underneath." body="Hermes, OpenClaw, and other MCP clients use the same local runtime. VitalMCP keeps crypto, storage, and health semantics outside any single Agent." />
          <div className="builder-links"><a href={githubUrl} target="_blank" rel="noreferrer">Explore the repository <ExternalLink size={15} /></a><button type="button" onClick={() => onNavigate(4)}>Compare deployment modes <ArrowRight size={15} /></button></div>
          <div className="builder-facts"><span><ShieldCheck size={15} /> Scoped by default</span><span><Zap size={15} /> Freshness attached</span></div>
        </div>
        <div className="tool-table">
          <div className="tool-head"><span>MCP tool</span><span>Returns</span></div>
          {tools.map(([name, description]) => <div className="tool-row" key={name}><code>{name}</code><span>{description}</span></div>)}
          <div className="tool-foot"><Zap size={14} /> Every relevant response includes freshness metadata.</div>
        </div>
      </div>
    </SnapPage>
  );
}

function FinalPage({ copied, onCopy, onNavigate }: { copied: boolean; onCopy: () => void; onNavigate: (index: number) => void }) {
  return (
    <SnapPage id="install-now" className="final-page">
      <div className="final-code" aria-hidden="true">HL/08</div>
      <div className="page-width final-page-inner">
        <p className="page-kicker light"><span /> Give your agent better context</p>
        <h2>Start locally with one command.</h2>
        <p>LAN is the zero-account default. VitalMCP detects supported Agents or prints standard MCP config for any compatible client; add your own Tailscale network only when you need private remote access.</p>
        <CommandBar copied={copied} onCopy={onCopy} inverse />
        <button type="button" className="back-to-top" onClick={() => onNavigate(0)}>Back to overview <ArrowRight size={15} /></button>
      </div>
      <footer className="page-width final-footer"><span><BrandMark className="footer-brand-mark" /> VitalMCP</span><p>Private Apple Health context for MCP-compatible agents.</p><div><a href={githubUrl}>GitHub</a><button type="button" onClick={() => onNavigate(3)}>Privacy</button><button type="button" onClick={() => onNavigate(4)}>Self-host</button></div></footer>
    </SnapPage>
  );
}

function SnapPage({ id, className, children }: { id: string; className: string; children: ReactNode }) {
  return <section className={`snap-page ${className}`} id={id} data-snap-section>{children}</section>;
}

function PageTitle({ kicker, title, body, light = false }: { kicker: string; title: string; body?: string; light?: boolean }) {
  return <div className={`page-title ${light ? "light" : ""}`}><p className="page-kicker"><span />{kicker}</p><h2>{title}</h2>{body && <p>{body}</p>}</div>;
}

function CommandBar({ copied, onCopy, inverse = false }: { copied: boolean; onCopy: () => void; inverse?: boolean }) {
  return <div className={`command-bar ${inverse ? "inverse" : ""}`}><span>$</span><code>{installCommand}</code><button type="button" onClick={onCopy} aria-label="Copy VitalMCP setup command">{copied ? <Check size={17} /> : <Copy size={17} />}<strong>{copied ? "Copied" : "Copy"}</strong></button></div>;
}

function BrandMark({ className, priority = false }: { className: string; priority?: boolean }) {
  return <span className={`brand-mark ${className}`} aria-hidden="true"><Image src={appIcon} alt="" width={64} height={64} priority={priority} /></span>;
}

function RouteNode({ icon: Icon, label, detail }: { icon: LucideIcon; label: string; detail: string }) {
  return <div className="route-node"><span><Icon size={18} /></span><div><strong>{label}</strong><small>{detail}</small></div></div>;
}

function RouteLine({ delay }: { delay: boolean }) {
  return <div className="route-line" aria-hidden="true"><span className={delay ? "delay" : ""} /></div>;
}

function RoutePoint({ icon: Icon, label, muted = false }: { icon: LucideIcon; label: string; muted?: boolean }) {
  return <div className={`route-point ${muted ? "muted" : ""}`}><span><Icon size={20} /></span><strong>{label}</strong></div>;
}
