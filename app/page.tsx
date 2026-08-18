"use client";
/* eslint-disable @next/next/no-html-link-for-pages */

import { useState } from "react";

const content = {
  en: {
    nav: ["Engineering", "Leadership", "NENXORAS", "Beyond", "Story", "Connect"],
    eyebrow: "SYSTEMS BUILDER · PROBLEM SOLVER · IMPACT DESIGNER",
    headline: ["Software engineer,", "roboticist, and", "founder building", "ambitious systems", "with purpose."],
    cta: "Explore my universe",
    chapter: "Current chapter · Building NENXORAS",
    scroll: "Scroll to explore",
    disciplines: ["Software Engineering", "Robotics", "AI", "Leadership"],
  },
  es: {
    nav: ["Ingeniería", "Liderazgo", "NENXORAS", "Más allá", "Historia", "Contacto"],
    eyebrow: "CREADORA DE SISTEMAS · RESOLUCIÓN DE PROBLEMAS · IMPACTO",
    headline: ["Ingeniería de software,", "robótica y una", "fundadora creando", "sistemas ambiciosos", "con propósito."],
    cta: "Explora mi universo",
    chapter: "Capítulo actual · Construyendo NENXORAS",
    scroll: "Desliza para explorar",
    disciplines: ["Ingeniería de software", "Robótica", "Inteligencia artificial", "Liderazgo"],
  },
};

function OrbitSystem() {
  return (
    <div className="system-map" aria-label="Mapa orbital de áreas profesionales">
      <div className="system-glow" />
      <div className="system-axis axis-horizontal" />
      <div className="system-axis axis-vertical" />
      <div className="system-ring ring-a"><i /></div>
      <div className="system-ring ring-b"><i /></div>
      <div className="system-ring ring-c"><i /></div>
      <div className="system-boundary" />
      <div className="system-core" />
      <span className="system-point point-green" />
      <span className="system-point point-cream" />
      <span className="system-note note-a">Δv 7.82<br />T+ 00:22:17</span>
      <span className="system-note note-b">N 18.2103°<br />W −67.1396°</span>
      <span className="system-note note-c">φ 1.618<br />μ 398600.4418</span>
    </div>
  );
}

export default function Home() {
  const [language, setLanguage] = useState<"en" | "es">("en");
  const t = content[language];
  return (
    <main className="technical-home">
      <header className="technical-header">
        <a className="kv-mark" href="/" aria-label="Home"><span>K</span><i>V</i></a>
        <nav aria-label="Primary navigation">
          {t.nav.map((item, index) => <a className={index === 0 ? "active" : ""} href={index === 4 ? "/mi-historia" : `#${item.toLowerCase().replaceAll(" ", "-")}`} key={item}>{item}</a>)}
        </nav>
        <div className="language technical-language" aria-label="Language selector">
          <button className={language === "es" ? "active" : ""} onClick={() => setLanguage("es")}>ES</button><span>|</span>
          <button className={language === "en" ? "active" : ""} onClick={() => setLanguage("en")}>EN</button>
        </div>
      </header>

      <section className="technical-hero">
        <div className="hero-statement">
          <p className="tech-eyebrow"><i />{t.eyebrow}<i /></p>
          <h1>{t.headline.map((line) => <span key={line}>{line}</span>)}</h1>
          <div className="hero-actions">
            <a className="universe-link" href="#engineering">{t.cta}<span>⟶</span></a>
            <a className="chapter-chip" href="/mi-historia"><i />{t.chapter}</a>
          </div>
        </div>

        <OrbitSystem />

        <aside className="discipline-list">
          {t.disciplines.map((label, index) => <a href="#engineering" key={label}>
            <span className={`discipline-icon icon-${index + 1}`} aria-hidden="true" />
            <small>0{index + 1}</small><strong>{label}</strong>
          </a>)}
        </aside>

        <a className="technical-scroll" href="#engineering"><span>{t.scroll}</span><i /><b /></a>
        <div className="degree-scale" aria-hidden="true"><span>−120°</span><span>−90°</span><span>−60°</span><span>−30°</span><span>0°</span><span>30°</span><span>60°</span><span>90°</span><span>120°</span></div>
      </section>

      <section className="engineering-preview" id="engineering">
        <p>01 / {language === "en" ? "Engineering" : "Ingeniería"}</p>
        <h2>{language === "en" ? "Ideas become systems here." : "Aquí las ideas se convierten en sistemas."}</h2>
        <div className="preview-cards">
          <article><span>SOFTWARE</span><h3>Full-stack systems</h3><p>Products shaped from architecture to interface.</p></article>
          <article><span>ROBOTICS</span><h3>Machines with purpose</h3><p>Autonomy, embedded software, and human-centered ideas.</p></article>
          <article><span>IN PROGRESS</span><h3>NENXORAS</h3><p>A growing ecosystem of tools, intelligence, and robotics.</p></article>
        </div>
      </section>
    </main>
  );
}
