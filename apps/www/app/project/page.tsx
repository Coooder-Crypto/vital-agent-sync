import type { Metadata } from "next";
import { githubUrl, npmUrl, productPrinciples, productSummary, siteUrl, skillHubUrl } from "../site-config";

export const metadata: Metadata = {
  title: "Project brief",
  description:
    "The problem, working product loop, design principles, current status, and context-scaling thesis behind Vital Agent Sync.",
  alternates: {
    canonical: "/project",
  },
  openGraph: {
    title: "Vital Agent Sync project brief",
    description: productSummary,
    url: "/project",
    type: "article",
  },
};

const productLoop = [
  ["Apple Health", "The iPhone reads only the HealthKit categories the user authorizes."],
  ["iPhone summaries", "The app prepares compact summaries instead of giving an Agent direct HealthKit access."],
  ["Local receiver", "Encrypted sync lands in a user-controlled SQLite database on the user’s machine."],
  ["MCP", "Standard tools return scoped context with source and freshness metadata."],
  ["Authorized Agent", "The Agent receives the evidence needed for a question, not blanket health-data access."],
];

const currentCapabilities = [
  "A physical iPhone can pair with the receiver and sync user-authorized Apple Health summaries.",
  "The local runtime stores summaries in SQLite and exposes them through MCP tools.",
  "WorkBuddy users can install the Skill from SkillHub and start the guided LAN setup from a conversation.",
  "The npm package provides the same runtime for WorkBuddy, Hermes, OpenClaw, and generic MCP clients.",
  "Trusted LAN is the default route; a user-managed Tailscale network is the optional private remote route.",
];

const currentLimits = [
  "The iOS app is a development build and is not yet distributed through the App Store.",
  "The Local Preview relies on a foreground iPhone sync; it does not promise a fixed background schedule.",
  "Hosted relay is experimental and is not required, available, or recommended for the current onboarding path.",
  "Vital Agent Sync is not a medical service and does not diagnose, prescribe, or replace professional care.",
];

const faqs = [
  {
    question: "Does an AI Agent receive HealthKit permission?",
    answer:
      "No. HealthKit access stays in the iPhone app. An authorized Agent can only call scoped MCP tools against summaries already synced to the user-controlled receiver.",
  },
  {
    question: "Does local storage mean the model is local?",
    answer:
      "No. The database and receiver stay on the user’s machine, but context returned through MCP may be sent to the model provider selected in the Agent. Users should choose that provider and scope deliberately.",
  },
  {
    question: "What does context scaling mean here?",
    answer:
      "It does not mean a longer prompt. It means continuously acquiring, filtering, verifying, and safely using relevant real-world context while preserving provenance, freshness, permission, and user control.",
  },
  {
    question: "Why begin with Apple Health?",
    answer:
      "Health data makes freshness, sensitivity, provenance, and revocation impossible to ignore. It is a demanding first source for testing a broader user-owned context layer.",
  },
];

const projectStructuredData = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "@id": `${siteUrl}/project#faq`,
  mainEntity: faqs.map(({ question, answer }) => ({
    "@type": "Question",
    name: question,
    acceptedAnswer: {
      "@type": "Answer",
      text: answer,
    },
  })),
};

export default function ProjectBriefPage() {
  return (
    <main className="project-brief">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(projectStructuredData) }}
      />
      <header className="project-brief-header">
        <a className="project-brief-brand" href="/" aria-label="Vital Agent Sync home">
          <span>VAS</span>
          <strong>Vital Agent Sync</strong>
        </a>
        <nav aria-label="Project links">
          <a href={skillHubUrl}>SkillHub</a>
          <a href={npmUrl}>npm</a>
          <a href={githubUrl}>GitHub</a>
        </nav>
      </header>

      <article>
        <section className="project-brief-hero" aria-labelledby="project-title">
          <p className="project-brief-kicker">Hackathon project brief</p>
          <h1 id="project-title">Apple Health context. Private by design.</h1>
          <p className="project-brief-deck">{productSummary}</p>
          <div className="project-brief-thesis">
            <p>Model scaling determines what AI can do.</p>
            <p>Context scaling determines whether it can do it for me.</p>
          </div>
        </section>

        <section className="project-brief-section project-brief-problem" aria-labelledby="problem-title">
          <div>
            <p className="project-brief-kicker">01 / The problem</p>
            <h2 id="problem-title">AI can understand the world, but it does not know today’s you.</h2>
          </div>
          <div className="project-brief-question">
            <blockquote>“Based on last night’s sleep and my current state, am I ready for a hard workout?”</blockquote>
            <p>
              Without current personal evidence, an Agent does not know how long the user slept, whether the
              data is fresh, or whether its assumptions match the user’s real state. It can only produce a
              generic answer.
            </p>
          </div>
        </section>

        <section className="project-brief-section" aria-labelledby="product-title">
          <div>
            <p className="project-brief-kicker">02 / The product</p>
            <h2 id="product-title">A user-controlled path from Apple Health to an authorized Agent.</h2>
            <p>
              The Agent never accesses HealthKit directly. The iPhone syncs authorized summaries, and the Agent
              asks for the minimum necessary context through MCP.
            </p>
          </div>
          <ol className="project-loop">
            {productLoop.map(([title, description], index) => (
              <li key={title}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <h3>{title}</h3>
                  <p>{description}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="project-brief-tags" aria-label="Core product properties">
            <span>Scoped</span>
            <span>Fresh</span>
            <span>Revocable</span>
          </div>
        </section>

        <section className="project-brief-section project-brief-proof" aria-labelledby="proof-title">
          <div>
            <p className="project-brief-kicker">03 / Working proof</p>
            <h2 id="proof-title">The Agent gets evidence, not HealthKit permission.</h2>
          </div>
          <div>
            <p>
              The working loop runs across a physical iPhone, an encrypted local receiver, SQLite, and MCP:
              configure the runtime, scan the local pairing QR, approve Health permissions, sync, and ask an
              Agent a personal-state question.
            </p>
            <ul>
              <li>Every relevant result identifies when the source data was last updated.</li>
              <li>Observed Apple Health facts are kept separate from limited Agent inference.</li>
              <li>Missing or stale data is reported instead of silently filled in.</li>
              <li>The connection can be inspected and revoked by the user.</li>
            </ul>
          </div>
        </section>

        <section className="project-brief-section project-brief-origin" aria-labelledby="origin-title">
          <div>
            <p className="project-brief-kicker">04 / Why this exists</p>
            <h2 id="origin-title">A more personal AI should not require surrendering all personal data.</h2>
          </div>
          <p>
            Apple Health already contains a rich record of daily life, and modern models are capable of using
            that evidence. What is missing is a safe, continuous, controllable connection between the two.
            Existing paths often mean repeated manual exports or moving the entire dataset into a central
            platform. Vital Agent Sync tests a different bargain: useful context without transferring ownership.
          </p>
        </section>

        <section className="project-brief-section project-brief-scaling" aria-labelledby="scaling-title">
          <div>
            <p className="project-brief-kicker">05 / Core thesis</p>
            <h2 id="scaling-title">The next scaling axis is context.</h2>
          </div>
          <div className="scaling-columns">
            <div>
              <h3>Model scaling</h3>
              <ul>
                <li>Reasoning</li>
                <li>Multimodality</li>
                <li>Tool use</li>
                <li>Capability</li>
              </ul>
            </div>
            <div>
              <h3>Context scaling</h3>
              <ul>
                <li>Identity</li>
                <li>Memory</li>
                <li>Real-world state</li>
                <li>Freshness</li>
                <li>Permission</li>
              </ul>
            </div>
          </div>
          <p className="project-brief-definition">
            Context scaling is not a longer context window. It is the ability to continuously acquire, select,
            verify, and safely use real-world context.
          </p>
        </section>

        <section className="project-brief-section" aria-labelledby="principles-title">
          <div>
            <p className="project-brief-kicker">06 / Design principles</p>
            <h2 id="principles-title">Context should scale without transferring ownership.</h2>
          </div>
          <ol className="principle-grid">
            {productPrinciples.map((principle, index) => (
              <li key={principle}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <p>{principle}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="project-brief-section project-brief-status" aria-labelledby="status-title">
          <div>
            <p className="project-brief-kicker">07 / Current status</p>
            <h2 id="status-title">Local Preview is working; the product boundary is explicit.</h2>
          </div>
          <div className="status-columns">
            <div>
              <h3>Implemented now</h3>
              <ul>
                {currentCapabilities.map((capability) => <li key={capability}>{capability}</li>)}
              </ul>
            </div>
            <div>
              <h3>Not claimed yet</h3>
              <ul>
                {currentLimits.map((limit) => <li key={limit}>{limit}</li>)}
              </ul>
            </div>
          </div>
        </section>

        <section className="project-brief-section project-brief-future" aria-labelledby="future-title">
          <div>
            <p className="project-brief-kicker">08 / Direction</p>
            <h2 id="future-title">Health is the starting point, not the boundary.</h2>
          </div>
          <p>
            The long-term direction is a user-owned context layer that can connect more personal data sources to
            more authorized Agents while preserving scope, provenance, freshness, auditability, and revocation.
            Vital Agent Sync begins with Apple Health because sensitive health context makes those requirements
            concrete from day one.
          </p>
        </section>

        <section className="project-brief-section project-brief-faq" aria-labelledby="faq-title">
          <div>
            <p className="project-brief-kicker">09 / Clear answers</p>
            <h2 id="faq-title">Frequently asked questions</h2>
          </div>
          <dl>
            {faqs.map(({ question, answer }) => (
              <div key={question}>
                <dt>{question}</dt>
                <dd>{answer}</dd>
              </div>
            ))}
          </dl>
        </section>

        <footer className="project-brief-footer">
          <div>
            <p className="project-brief-kicker">The idea in one sentence</p>
            <h2>
              Private context should be able to scale like model capability—and still belong to the user.
            </h2>
          </div>
          <nav aria-label="Project resources">
            <a href="/">Product overview</a>
            <a href={skillHubUrl}>WorkBuddy Skill</a>
            <a href={npmUrl}>vitalmcp on npm</a>
            <a href={githubUrl}>Open-source repository</a>
          </nav>
        </footer>
      </article>
    </main>
  );
}
