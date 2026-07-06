import {
  ArrowRight,
  Bot,
  Check,
  ChevronRight,
  CircleDot,
  Cpu,
  Database,
  Fingerprint,
  Github,
  HeartPulse,
  ImageIcon,
  Link2,
  LockKeyhole,
  Play,
  QrCode,
  ScanLine,
  Server,
  ShieldCheck,
  Sparkles,
  Smartphone,
  Terminal,
  Video,
  Zap,
} from "lucide-react";

const installCommand = "npx -y healthlink-local setup --agent hermes --service";

const features = [
  {
    icon: HeartPulse,
    title: "Health summaries, not raw exhaust",
    body: "Sync compact daily context from Apple Health: sleep, recovery, activity, workouts, and freshness metadata.",
  },
  {
    icon: LockKeyhole,
    title: "Local-first by default",
    body: "Your local receiver stores data in SQLite and exposes it through MCP. No HealthLink cloud is required.",
  },
  {
    icon: ShieldCheck,
    title: "Scoped and auditable access",
    body: "Agents read through scoped tools, with source devices, revocation, and audit logs built into the gateway model.",
  },
];

const steps = [
  {
    label: "Install",
    title: "Start the local receiver",
    body: "Run one command on the machine where your agent lives. HealthLink starts the service and prints a pairing QR.",
    icon: Terminal,
  },
  {
    label: "Pair",
    title: "Scan from iPhone",
    body: "Approve the server, choose health scopes, grant Apple permissions, then let the app keep summaries fresh.",
    icon: QrCode,
  },
  {
    label: "Ask",
    title: "Give agents context",
    body: "Hermes or any MCP-compatible agent can call HealthLink tools when you ask about energy, sleep, or readiness.",
    icon: Sparkles,
  },
];

const toolRows = [
  ["get_personal_context", "Best default for daily state, readiness, and broad health questions."],
  ["get_sleep_trend", "Returns recent sleep duration and freshness for recovery analysis."],
  ["get_workout_load", "Summarizes workout strain and activity load across recent days."],
  ["get_recovery_signals", "Combines resting heart rate, HRV, sleep, and activity signals."],
];

const privacyPoints = [
  "No cloud dependency for the default local mode.",
  "Agents never talk to HealthKit directly.",
  "Source devices and agent clients can be revoked.",
  "Default MCP tools expose summaries, not raw samples.",
];

export default function Home() {
  return (
    <main className="relative overflow-hidden">
      <div className="mesh-grid pointer-events-none absolute inset-x-0 top-0 h-[760px]" />
      <SiteHeader />
      <HeroSection />
      <LogoStrip />
      <FeatureHighlights />
      <HowItWorks />
      <MediaShowcase />
      <Architecture />
      <PrivacySection />
      <ToolsSection />
      <FinalCta />
    </main>
  );
}

function SiteHeader() {
  return (
    <header className="relative z-20 mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8">
      <a className="flex items-center gap-3" href="#">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-400 text-slate-950">
          <HeartPulse size={20} strokeWidth={2.4} />
        </span>
        <span className="text-sm font-semibold tracking-wide text-white">HealthLink</span>
      </a>
      <nav className="hidden items-center gap-8 text-sm text-slate-300 md:flex">
        <a className="transition hover:text-white" href="#flow">
          Flow
        </a>
        <a className="transition hover:text-white" href="#architecture">
          Architecture
        </a>
        <a className="transition hover:text-white" href="#privacy">
          Privacy
        </a>
        <a className="transition hover:text-white" href="#tools">
          MCP Tools
        </a>
      </nav>
      <a
        className="inline-flex h-10 items-center gap-2 rounded-lg border border-white/15 bg-white/8 px-4 text-sm font-medium text-white transition hover:bg-white/14"
        href="https://github.com/Coooder-Crypto/health-link"
      >
        <Github size={16} />
        GitHub
      </a>
    </header>
  );
}

function HeroSection() {
  return (
    <section className="relative z-10 mx-auto grid max-w-7xl items-center gap-12 px-5 pb-20 pt-10 sm:px-8 lg:grid-cols-[1fr_0.95fr] lg:pb-28 lg:pt-18">
      <div className="min-w-0">
        <div className="fade-up mb-7 inline-flex items-center gap-2 rounded-full border border-emerald-300/25 bg-emerald-300/10 px-3 py-1.5 text-sm text-emerald-100">
          <CircleDot size={14} className="pulse-dot text-emerald-300" />
          Private health context for local AI agents
        </div>
        <h1 className="fade-up max-w-4xl text-4xl font-semibold leading-[1.04] tracking-normal text-white sm:text-6xl lg:text-7xl">
          Pair your iPhone once. Ask your agent anytime.
        </h1>
        <p className="fade-up mt-6 max-w-2xl text-lg leading-8 text-slate-300 sm:text-xl [animation-delay:110ms]">
          HealthLink syncs authorized Apple Health summaries to your own local gateway,
          then exposes fresh personal context through MCP tools your agent can understand.
        </p>
        <div className="fade-up mt-8 flex flex-col gap-3 sm:flex-row [animation-delay:180ms]">
          <a
            className="lift inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-emerald-300 px-5 text-sm font-semibold text-slate-950 transition hover:bg-emerald-200"
            href="#install"
          >
            Start with one command
            <ArrowRight size={16} />
          </a>
          <a
            className="lift inline-flex h-12 items-center justify-center gap-2 rounded-lg border border-white/14 bg-white/7 px-5 text-sm font-semibold text-white transition hover:bg-white/12"
            href="#architecture"
          >
            See architecture
            <ChevronRight size={16} />
          </a>
        </div>
        <CommandCard />
      </div>
      <div className="min-w-0">
        <ProductVisual />
      </div>
    </section>
  );
}

function CommandCard() {
  return (
    <div id="install" className="fade-up mt-9 max-w-2xl rounded-xl border border-white/12 bg-black/45 p-3 shadow-2xl [animation-delay:250ms]">
      <div className="mb-3 flex items-center justify-between px-2 pt-1">
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full bg-rose-400" />
          <span className="h-3 w-3 rounded-full bg-amber-300" />
          <span className="h-3 w-3 rounded-full bg-emerald-300" />
        </div>
        <span className="text-xs text-slate-500">local setup</span>
      </div>
      <div className="overflow-x-auto rounded-lg bg-slate-950/85 px-4 py-4">
        <code className="whitespace-nowrap text-sm text-emerald-200 sm:text-base">
          <span className="text-slate-500">$ </span>
          {installCommand}
        </code>
      </div>
    </div>
  );
}

function ProductVisual() {
  return (
    <div className="hero-orbit float-panel relative mx-auto w-full max-w-xl">
      <div className="absolute -inset-10 rounded-full bg-emerald-400/10 blur-3xl" />
      <div className="absolute -right-8 top-12 h-40 w-40 rounded-full bg-violet-400/10 blur-3xl" />
      <div className="screen-glow relative overflow-hidden rounded-[1.25rem] border border-white/10 bg-slate-950/86 p-4 backdrop-blur">
        <div className="data-rail data-rail-a" />
        <div className="data-rail data-rail-b" />
        <div className="mb-5 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-white">Live pairing route</p>
            <p className="mt-1 text-xs text-slate-500">Health summaries move through your machine.</p>
          </div>
          <span className="inline-flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1 text-xs font-medium text-emerald-100">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
            local mode
          </span>
        </div>

        <div className="relative grid min-h-[520px] gap-4 lg:grid-cols-[0.72fr_0.56fr_0.9fr]">
          <div className="device-frame relative z-10 self-center rounded-[1.75rem] border border-white/12 bg-black/50 p-3">
            <div className="mx-auto mb-3 h-1.5 w-14 rounded-full bg-white/20" />
            <div className="rounded-[1.35rem] border border-white/10 bg-slate-950 p-4">
              <div className="mb-5 flex items-center justify-between">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-300 text-slate-950">
                  <HeartPulse size={20} />
                </div>
                <ScanLine className="text-emerald-200" size={22} />
              </div>
              <p className="text-xs text-slate-500">HealthLink iOS</p>
              <h3 className="mt-1 text-lg font-semibold text-white">Ready to sync</h3>
              <div className="mt-5 space-y-3">
                <MetricBar label="Sleep" value="6h 42m" tone="emerald" width="74%" />
                <MetricBar label="Steps" value="8,420" tone="blue" width="82%" />
                <MetricBar label="HRV" value="42 ms" tone="violet" width="58%" />
              </div>
              <div className="mt-5 rounded-xl border border-emerald-300/20 bg-emerald-300/10 p-3">
                <QrCode className="mb-3 text-emerald-200" size={24} />
                <p className="text-xs font-medium text-white">Pairing QR approved</p>
                <p className="mt-1 text-xs leading-5 text-slate-400">Scopes selected on device.</p>
              </div>
            </div>
          </div>

          <div className="relative z-20 flex flex-col items-center justify-center gap-5 py-4">
            <PipelineNode icon={Server} label="LAN receiver" tone="emerald" />
            <div className="pipeline-spine" />
            <PipelineNode icon={Database} label="SQLite" tone="blue" />
            <div className="pipeline-spine" />
            <PipelineNode icon={Cpu} label="MCP" tone="violet" />
          </div>

          <div className="relative z-10 self-center rounded-2xl border border-white/10 bg-black/45 p-4">
            <div className="mb-4 flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-300/16 text-violet-100">
                <Bot size={21} />
              </span>
              <div>
                <p className="text-sm font-medium text-white">Agent context</p>
                <p className="text-xs text-slate-500">freshness: 4 min</p>
              </div>
            </div>
            <div className="rounded-xl border border-white/10 bg-slate-950/80 p-4">
              <p className="typing-line text-sm leading-6 text-slate-300">
                You slept a little under baseline. Recovery signals are stable, so keep training moderate today.
              </p>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <SignalTile label="scope" value="health.daily" />
              <SignalTile label="audit" value="recorded" />
            </div>
            <div className="mt-4 rounded-xl border border-amber-300/16 bg-amber-300/8 p-3">
              <div className="flex items-center gap-2 text-xs font-medium text-amber-100">
                <ShieldCheck size={15} />
                Agent reads summaries, not raw HealthKit samples.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PipelineNode({
  icon: Icon,
  label,
  tone,
}: {
  icon: typeof Server;
  label: string;
  tone: "emerald" | "blue" | "violet";
}) {
  const tones = {
    emerald: "border-emerald-300/30 bg-emerald-300/12 text-emerald-100 shadow-emerald-300/20",
    blue: "border-sky-300/30 bg-sky-300/12 text-sky-100 shadow-sky-300/20",
    violet: "border-violet-300/30 bg-violet-300/12 text-violet-100 shadow-violet-300/20",
  };

  return (
    <div className={`node-pulse flex h-20 w-20 flex-col items-center justify-center rounded-2xl border shadow-xl ${tones[tone]}`}>
      <Icon size={22} />
      <span className="mt-2 text-[10px] font-medium">{label}</span>
    </div>
  );
}

function MetricBar({
  label,
  value,
  tone,
  width,
}: {
  label: string;
  value: string;
  tone: "emerald" | "blue" | "violet";
  width: string;
}) {
  const tones = {
    emerald: "from-emerald-300 to-emerald-500",
    blue: "from-sky-300 to-blue-500",
    violet: "from-violet-300 to-fuchsia-500",
  };

  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="text-slate-500">{label}</span>
        <span className="font-medium text-white">{value}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
        <div className={`h-full rounded-full bg-gradient-to-r ${tones[tone]}`} style={{ width }} />
      </div>
    </div>
  );
}

function SignalTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
      <p className="text-[10px] uppercase text-slate-500">{label}</p>
      <p className="mt-1 text-xs font-medium text-white">{value}</p>
    </div>
  );
}

function LogoStrip() {
  return (
    <section className="relative z-10 border-y border-white/10 bg-white/[0.03]">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-6 sm:px-8 md:flex-row md:items-center md:justify-between">
        <p className="text-sm text-slate-400">Built for local-first agent workflows</p>
        <div className="flex flex-wrap gap-3 text-sm text-slate-300">
          {["Apple Health", "SQLite", "MCP", "Hermes", "OpenClaw", "Tailscale"].map((item) => (
            <span key={item} className="lift rounded-lg border border-white/10 bg-black/20 px-3 py-1.5">
              {item}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function FeatureHighlights() {
  return (
    <section className="relative z-10 mx-auto max-w-7xl px-5 py-20 sm:px-8">
      <div className="grid gap-4 lg:grid-cols-3">
        {features.map((feature) => (
          <div key={feature.title} className="lift glass rounded-2xl p-6">
            <feature.icon className="mb-8 text-emerald-200" size={26} />
            <h3 className="text-xl font-semibold text-white">{feature.title}</h3>
            <p className="mt-3 leading-7 text-slate-300">{feature.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section id="flow" className="relative z-10 mx-auto max-w-7xl px-5 py-24 sm:px-8">
      <SectionHeader
        eyebrow="Launch flow"
        title="The setup should feel boringly simple."
        body="HealthLink hides HealthKit permissions, pairing, local storage, and MCP wiring behind a short path a real user can finish."
      />
      <div className="mt-12 grid gap-4 lg:grid-cols-3">
        {steps.map((step, index) => (
          <div key={step.title} className="lift glass rounded-2xl p-6">
            <div className="mb-8 flex items-center justify-between">
              <span className="rounded-full border border-white/12 bg-white/8 px-3 py-1 text-xs font-medium text-slate-300">
                {step.label}
              </span>
              <step.icon className="text-emerald-200" size={24} />
            </div>
            <p className="text-sm text-slate-500">0{index + 1}</p>
            <h3 className="mt-3 text-xl font-semibold text-white">{step.title}</h3>
            <p className="mt-3 leading-7 text-slate-300">{step.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function MediaShowcase() {
  return (
    <section className="relative z-10 mx-auto max-w-7xl px-5 py-16 sm:px-8">
      <div className="grid gap-6 lg:grid-cols-[0.85fr_1.15fr] lg:items-stretch">
        <div className="glass rounded-2xl p-7 sm:p-9">
          <SectionHeader
            eyebrow="Product media"
            title="Leave room for the real app story."
            body="This section is ready for future device screenshots, pairing clips, or a short launch demo video. The placeholders keep the page complete until real assets are recorded."
          />
          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            <MediaSlot icon={Smartphone} label="iPhone screenshots" detail="Replace with Home, Sources, and Connection screens." />
            <MediaSlot icon={Video} label="Demo video" detail="Drop in a 30-60 second setup walkthrough." />
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-[0.72fr_1fr]">
          <div className="device-frame lift min-h-[520px] rounded-[2rem] border border-white/12 bg-slate-950/80 p-4">
            <div className="mx-auto mb-4 h-1.5 w-16 rounded-full bg-white/20" />
            <div className="media-sheen flex h-full min-h-[455px] flex-col justify-between overflow-hidden rounded-[1.5rem] border border-white/10 bg-black/35 p-5">
              <div>
                <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-300/14 text-emerald-200">
                  <ImageIcon size={24} />
                </div>
                <p className="text-sm font-medium text-white">Future iPhone capture</p>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  Use this for a real HealthLink screen once the launch visuals are ready.
                </p>
              </div>
              <div className="space-y-3">
                <div className="h-20 rounded-xl border border-white/10 bg-white/[0.05]" />
                <div className="h-14 rounded-xl border border-white/10 bg-white/[0.04]" />
                <div className="h-24 rounded-xl border border-emerald-300/20 bg-emerald-300/8" />
              </div>
            </div>
          </div>
          <div className="video-frame lift relative min-h-[360px] overflow-hidden rounded-2xl border border-white/12 bg-slate-950/80 p-4 md:min-h-full">
            <div className="media-sheen absolute inset-4 rounded-xl border border-white/10 bg-black/40" />
            <div className="relative flex h-full min-h-[328px] flex-col justify-between rounded-xl p-6 md:min-h-[520px]">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>healthlink-demo.mp4</span>
                <span>placeholder</span>
              </div>
              <button className="lift mx-auto flex h-20 w-20 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white backdrop-blur">
                <Play size={28} fill="currentColor" />
              </button>
              <div>
                <p className="text-lg font-semibold text-white">Setup walkthrough</p>
                <p className="mt-2 max-w-md text-sm leading-6 text-slate-400">
                  Later: record install, QR scan, first sync, and an agent question in one short clip.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function MediaSlot({
  icon: Icon,
  label,
  detail,
}: {
  icon: typeof Smartphone;
  label: string;
  detail: string;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
      <Icon className="mb-4 text-emerald-200" size={22} />
      <p className="text-sm font-medium text-white">{label}</p>
      <p className="mt-2 text-xs leading-5 text-slate-400">{detail}</p>
    </div>
  );
}

function Architecture() {
  return (
    <section id="architecture" className="relative z-10 mx-auto max-w-7xl px-5 py-16 sm:px-8">
      <div className="grid gap-10 lg:grid-cols-[0.85fr_1fr] lg:items-center">
        <SectionHeader
          eyebrow="Architecture"
          title="A personal data gateway, not another health cloud."
          body="The stable contract is scoped pairing, normalized summaries, local storage, and MCP query tools. Source apps and agent adapters sit around that core."
        />
        <div className="glass rounded-2xl p-5">
          <div className="grid gap-3">
            <FlowNode icon={HeartPulse} title="HealthLink iOS" body="Apple permissions, HealthKit collection, QR pairing." />
            <FlowConnector />
            <FlowNode icon={Server} title="healthlink-local" body="LAN receiver, pairing sessions, scoped ingest API." />
            <FlowConnector />
            <FlowNode icon={Database} title="Local SQLite store" body="Normalized summaries, source devices, audit logs." />
            <FlowConnector />
            <FlowNode icon={Link2} title="MCP tools" body="Fresh context for Hermes or any compatible agent." />
          </div>
        </div>
      </div>
    </section>
  );
}

function FlowNode({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof HeartPulse;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-slate-950/60 p-4">
      <div className="flex items-start gap-4">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-emerald-300/12 text-emerald-200">
          <Icon size={21} />
        </span>
        <div>
          <h3 className="font-semibold text-white">{title}</h3>
          <p className="mt-1 text-sm leading-6 text-slate-400">{body}</p>
        </div>
      </div>
    </div>
  );
}

function FlowConnector() {
  return <div className="panel-line mx-8 h-px" />;
}

function PrivacySection() {
  return (
    <section id="privacy" className="relative z-10 mx-auto max-w-7xl px-5 py-24 sm:px-8">
      <div className="grid gap-6 lg:grid-cols-[1fr_0.9fr]">
        <div className="glass rounded-2xl p-7 sm:p-9">
          <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-lg bg-emerald-300 text-slate-950">
            <Fingerprint size={24} />
          </div>
          <h2 className="max-w-2xl text-3xl font-semibold leading-tight text-white sm:text-4xl">
            Privacy is a product boundary, not a settings page.
          </h2>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-300">
            HealthLink is intentionally not an agent. It is a user-controlled connector that
            lets agents read authorized context without owning the health data pipeline.
          </p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-slate-950/55 p-6">
          <div className="space-y-4">
            {privacyPoints.map((point) => (
              <div key={point} className="flex gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-4">
                <Check className="mt-0.5 shrink-0 text-emerald-300" size={18} />
                <p className="leading-6 text-slate-300">{point}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function ToolsSection() {
  return (
    <section id="tools" className="relative z-10 mx-auto max-w-7xl px-5 py-16 sm:px-8">
      <SectionHeader
        eyebrow="MCP tools"
        title="Give agents the context layer they are missing."
        body="The agent asks through HealthLink tools. HealthLink returns freshness-aware context and records access locally."
      />
      <div className="mt-12 overflow-hidden rounded-2xl border border-white/10 bg-black/45">
        {toolRows.map(([name, description]) => (
          <div key={name} className="grid gap-3 border-b border-white/10 p-5 last:border-b-0 md:grid-cols-[0.38fr_1fr]">
            <code className="text-sm text-emerald-200">{name}</code>
            <p className="text-sm leading-6 text-slate-300">{description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="relative z-10 mx-auto max-w-7xl px-5 py-24 sm:px-8">
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.06] p-8 sm:p-10">
        <div className="grid gap-8 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/12 bg-black/20 px-3 py-1.5 text-sm text-slate-300">
              <Zap size={14} className="text-emerald-300" />
              Ready for a developer-first launch
            </div>
            <h2 className="max-w-3xl text-3xl font-semibold leading-tight text-white sm:text-4xl">
              Ship the connector first. Let the agent ecosystem meet it through MCP.
            </h2>
          </div>
          <a
            className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-white px-5 text-sm font-semibold text-slate-950 transition hover:bg-emerald-100"
            href="#install"
          >
            Copy install command
            <ArrowRight size={16} />
          </a>
        </div>
      </div>
      <footer className="flex flex-col gap-4 border-t border-white/10 py-8 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
        <p>HealthLink. User-owned personal context for AI agents.</p>
        <div className="flex gap-5">
          <a className="hover:text-white" href="https://github.com/Coooder-Crypto/health-link">
            GitHub
          </a>
          <a className="hover:text-white" href="#privacy">
            Privacy
          </a>
        </div>
      </footer>
    </section>
  );
}

function SectionHeader({ eyebrow, title, body }: { eyebrow: string; title: string; body: string }) {
  return (
    <div>
      <p className="mb-3 text-sm font-medium text-emerald-200">{eyebrow}</p>
      <h2 className="max-w-3xl text-3xl font-semibold leading-tight text-white sm:text-4xl lg:text-5xl">
        {title}
      </h2>
      <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-300">{body}</p>
    </div>
  );
}
