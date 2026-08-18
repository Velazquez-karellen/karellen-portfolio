"use client";
/* eslint-disable @next/next/no-html-link-for-pages */

import { useState } from "react";

const chapters = [
  { number: "01", kicker: "Independencia y crecimiento", title: "Aprender a valerme por mí misma", body: "Cuando miro hacia atrás, el comienzo de la universidad marca una frontera clara. Vivir lejos de mi familia significó aprender a resolver problemas, administrar responsabilidades y tomar decisiones por mi cuenta. La independencia no llegó en una sola noche; se construyó en experiencias pequeñas que, poco a poco, cambiaron mi forma de verme." },
  { number: "02", kicker: "Tecnología, software y robótica", title: "Encontrar mi lugar mientras lo construía", body: "La robótica no apareció como una revelación repentina. Fue creciendo entre mis primeros proyectos de software, SpectrumX, la investigación de sistemas autónomos y UAVs, AON Robotics, ASME SDC y proyectos propios. Cada experiencia añadió una pieza hasta dejarme ver el tipo de problemas que quiero aprender a resolver." },
  { number: "03", kicker: "Liderazgo, comunidad e impacto", title: "Crecer mientras ayudaba a otros a comenzar", body: "Pasar de participar a presidir IEEE WIE transformó mi idea del liderazgo. Al mismo tiempo, orientar a estudiantes que comenzaban su etapa universitaria me permitió reconocer mi propio recorrido. Liderar comenzó a significar abrir espacio, escuchar y hacer que el camino de alguien más se sintiera un poco menos incierto." },
];

export default function StoryPage() {
  const [english, setEnglish] = useState(false);
  return (
    <main className="story-page">
      <header className="site-header story-header">
        <a className="mark" href="/" aria-label="Volver al inicio"><span /><span /></a>
        <a className="back-home" href="/">← {english ? "Home" : "Inicio"}</a>
        <div className="language">
          <button className={!english ? "active" : ""} onClick={() => setEnglish(false)}>ES</button><span>/</span>
          <button className={english ? "active" : ""} onClick={() => setEnglish(true)}>EN</button>
        </div>
      </header>
      <article className="story-article">
        <header className="story-intro">
          <p className="eyebrow"><span />{english ? "My living story" : "Mi historia viva"}</p>
          <h1>{english ? "I am still becoming." : "Todavía me estoy convirtiendo."}</h1>
          <p>{english ? "I am building the English edition alongside the story itself. For now, the first complete editorial draft lives in Spanish." : "Hoy vivo entre software, robótica, liderazgo y proyectos que apenas comienzan. Pero para entender cómo llegué hasta aquí, tengo que volver al momento en que la universidad me enseñó a sostenerme por mi cuenta."}</p>
          <div className="story-meta"><span>2023 — {english ? "Present" : "Presente"}</span><span>{english ? "Living document" : "Documento vivo"}</span></div>
        </header>
        {!english && <>
          <div className="story-divider"><span>El recorrido</span><i /></div>
          {chapters.map((chapter) => <section className="chapter" key={chapter.number}>
            <aside><strong>{chapter.number}</strong><span>{chapter.kicker}</span></aside>
            <div><h2>{chapter.title}</h2><p>{chapter.body}</p></div>
          </section>)}
          <footer className="story-ending"><p>Continuará</p><h2>Esta historia todavía está tomando forma.</h2><span>Última actualización · Agosto 2026</span></footer>
        </>}
      </article>
    </main>
  );
}
