"use client";
/* eslint-disable @next/next/no-html-link-for-pages, @next/next/no-img-element */

import { FormEvent, useEffect, useState } from "react";

type Item = { id: string; type: string; status: string; titleEs: string; titleEn: string; summaryEs: string; summaryEn: string; bodyEs: string; bodyEn: string; coverImage: string | null; updatedAt: string };
const empty = { id: "", type: "project", status: "draft", titleEs: "", titleEn: "", summaryEs: "", summaryEn: "", bodyEs: "", bodyEn: "", coverImage: "" };

export default function StudioClient({ displayName }: { displayName: string }) {
  const [items, setItems] = useState<Item[]>([]); const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false); const [message, setMessage] = useState("");
  const [tab, setTab] = useState<"es" | "en">("es");
  const load = async () => { const response = await fetch("/api/content?studio=1"); const data = await response.json(); setItems(data.items ?? []); };
  useEffect(() => {
    fetch("/api/content?studio=1").then((response) => response.json()).then((data) => setItems(data.items ?? []));
  }, []);
  const change = (name: string, value: string) => setForm((current) => ({ ...current, [name]: value }));
  const upload = async (file?: File) => {
    if (!file) return; setSaving(true); setMessage("Subiendo imagen…");
    const data = new FormData(); data.append("file", file); const response = await fetch("/api/uploads", { method: "POST", body: data });
    const result = await response.json(); setSaving(false); if (!response.ok) return setMessage(result.error ?? "No se pudo subir.");
    change("coverImage", result.url); setMessage("Imagen lista.");
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setMessage("Guardando…");
    const response = await fetch("/api/content", { method: form.id ? "PUT" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(form) });
    const result = await response.json(); setSaving(false); if (!response.ok) return setMessage(result.error ?? "No se pudo guardar.");
    setMessage(form.status === "published" ? "Publicado correctamente." : "Borrador guardado."); setForm(empty); await load();
  };
  const edit = (item: Item) => { setForm({ ...empty, ...item, coverImage: item.coverImage ?? "" }); window.scrollTo({ top: 0, behavior: "smooth" }); };
  return <main className="studio-shell">
    <header className="studio-header"><div><a href="/">KV / PORTFOLIO</a><span>CONTENT STUDIO</span></div><p>Hola, {displayName}</p></header>
    <div className="studio-grid"><section className="studio-editor">
      <div className="studio-title"><p>{form.id ? "EDITANDO CONTENIDO" : "NUEVA PUBLICACIÓN"}</p><h1>{form.id ? form.titleEs || "Sin título" : "¿Qué quieres compartir?"}</h1></div>
      <form onSubmit={submit}>
        <div className="studio-row"><label>Tipo<select value={form.type} onChange={(e) => change("type", e.target.value)}><option value="project">Proyecto</option><option value="post">Post</option><option value="story">Capítulo de historia</option><option value="book">Libro o recomendación</option><option value="travel">Viaje</option><option value="nenxoras">NENXORAS</option></select></label><label>Estado<select value={form.status} onChange={(e) => change("status", e.target.value)}><option value="draft">Borrador</option><option value="published">Publicado</option></select></label></div>
        <div className="editor-tabs"><button type="button" className={tab === "es" ? "active" : ""} onClick={() => setTab("es")}>Español</button><button type="button" className={tab === "en" ? "active" : ""} onClick={() => setTab("en")}>English</button></div>
        {tab === "es" ? <><label>Título<input required value={form.titleEs} onChange={(e) => change("titleEs", e.target.value)} placeholder="Título en español" /></label><label>Resumen<textarea rows={3} value={form.summaryEs} onChange={(e) => change("summaryEs", e.target.value)} placeholder="Una introducción breve" /></label><label>Contenido<textarea rows={9} value={form.bodyEs} onChange={(e) => change("bodyEs", e.target.value)} placeholder="Escribe aquí…" /></label></> : <><label>Title<input value={form.titleEn} onChange={(e) => change("titleEn", e.target.value)} placeholder="English title" /></label><label>Summary<textarea rows={3} value={form.summaryEn} onChange={(e) => change("summaryEn", e.target.value)} placeholder="Short introduction" /></label><label>Content<textarea rows={9} value={form.bodyEn} onChange={(e) => change("bodyEn", e.target.value)} placeholder="Write here…" /></label></>}
        <label className="upload-field">Imagen principal<input type="file" accept="image/*" onChange={(e) => void upload(e.target.files?.[0])} /><span>{form.coverImage ? "Cambiar imagen" : "Seleccionar o arrastrar imagen"}</span></label>
        {form.coverImage && <img className="cover-preview" src={form.coverImage} alt="Vista previa" />}
        <div className="studio-actions">{form.id && <button type="button" onClick={() => setForm(empty)}>Cancelar</button>}<button className="save-button" disabled={saving}>{saving ? "Procesando…" : form.status === "published" ? "Publicar" : "Guardar borrador"}</button></div>
        {message && <p className="studio-message" role="status">{message}</p>}
      </form>
    </section><aside className="content-library"><p>CONTENIDO</p><h2>Tu biblioteca</h2>{items.length === 0 ? <div className="empty-library">Aún no has creado publicaciones.</div> : items.map((item) => <button key={item.id} onClick={() => edit(item)}><small>{item.type} · {item.status}</small><strong>{item.titleEs}</strong><span>Editar →</span></button>)}</aside></div>
  </main>;
}
