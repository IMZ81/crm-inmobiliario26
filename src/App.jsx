import { useState, useEffect, useMemo } from "react";

// ─── Leer datos del Google Sheet publicado como CSV ───────────────────────────
const SHEET_URL = import.meta.env.VITE_SHEET_URL;

function parseCSV(text) {
  const lines = text.trim().split("\n");
  const headers = lines[0].split(",").map(h => h.trim().replace(/"/g, ""));
  return lines.slice(1).map((line, i) => {
    // handle quoted fields with commas inside
    const cols = [];
    let cur = "", inQ = false;
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; }
      else if (ch === "," && !inQ) { cols.push(cur.trim()); cur = ""; }
      else cur += ch;
    }
    cols.push(cur.trim());
    const obj = { id: i + 1 };
    headers.forEach((h, j) => { obj[h] = cols[j] ?? ""; });
    // normalize field names to match dashboard keys
    return {
      id:              obj["ID"] || String(i + 1),
      name:            obj["NOMBRE CONTACTO"] || "",
      phone:           obj["TELÉFONO"] || "",
      zone:            obj["ZONA / CALLE"] || "",
      channel:         obj["CANAL"] || "Llamada",
      agent:           obj["AGENTE"] || "",
      stage:           stageKey(obj["ETAPA"] || ""),
      pvp_salida:      obj["PVP SALIDA (€)"] || "",
      pvp_actual:      obj["PVP ACTUAL (€)"] || "",
      date:            obj["FECHA CAPTACIÓN"] || "",
      fecha_pub:       obj["FECHA ÚLT. PUB."] || "",
      dom:             obj["DOM"] || "",
      link_anuncio:    obj["LINK ANUNCIO"] || "",
      link_dashboard:  obj["LINK DASHBOARD"] || "",
      video:           obj["VÍDEO"] || "N",
      plano:           obj["PLANO"] || "N",
      notes:           obj["NOTAS"] || "",
    };
  }).filter(l => l.name);
}

// Map Spanish stage labels → internal keys
function stageKey(label) {
  const map = {
    "en observación": "observacion", "observación": "observacion",
    "captado": "captado",
    "1ª visita": "primera_visita", "primera visita": "primera_visita",
    "2ª visita em": "segunda_visita", "segunda visita em": "segunda_visita",
    "mandato firmado": "mandato",
    "anuncio publicado": "anuncio",
    "nº visitas inmueble": "visitas_inmueble", "visitas inmueble": "visitas_inmueble",
    "oferta recibida": "oferta",
    "vendido": "vendido",
  };
  return map[label.toLowerCase().trim()] || "observacion";
}

// ─── Constants ────────────────────────────────────────────────────────────────
const STAGES = [
  { id: "observacion",      label: "En Observación",      color: "#8b5cf6" },
  { id: "captado",          label: "Captado",              color: "#6366f1" },
  { id: "primera_visita",   label: "1ª Visita",            color: "#3b82f6" },
  { id: "segunda_visita",   label: "2ª Visita EM",         color: "#06b6d4" },
  { id: "mandato",          label: "Mandato Firmado",      color: "#10b981" },
  { id: "anuncio",          label: "Anuncio Publicado",    color: "#84cc16" },
  { id: "visitas_inmueble", label: "Nº Visitas Inmueble",  color: "#f59e0b" },
  { id: "oferta",           label: "Oferta Recibida",      color: "#f97316" },
  { id: "vendido",          label: "Vendido ✓",            color: "#22c55e" },
];
const STAGE_IDX = Object.fromEntries(STAGES.map((s, i) => [s.id, i]));
const NEXT = {};
STAGES.forEach((s, i) => { NEXT[s.id] = STAGES[i + 1]?.id ?? null; });

const CHANNELS = ["WhatsApp", "Llamada", "Email"];
const chColor  = { WhatsApp: "#25d366", Llamada: "#3b82f6", Email: "#f59e0b" };
const chIcon   = { WhatsApp: "💬", Llamada: "📞", Email: "✉️" };

const EMPTY = { name:"", phone:"", zone:"", channel:"WhatsApp", stage:"observacion", agent:"", date: new Date().toISOString().slice(0,10), pvp_salida:"", pvp_actual:"", dom:"", fecha_pub:"", link_anuncio:"", link_dashboard:"", video:"N", plano:"N", notes:"" };

function pct(a, b) { return b === 0 ? "—" : `${Math.round((a/b)*100)}%`; }
function pctVal(a, b) { return b === 0 ? 0 : Math.round((a/b)*100); }
function atOrPast(arr, stage) { const idx = STAGE_IDX[stage]; return arr.filter(l => STAGE_IDX[l.stage] >= idx).length; }
function fmt(n) { return n ? Number(n).toLocaleString("es-ES") + " €" : "—"; }

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [leads, setLeads]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [lastSync, setLastSync] = useState(null);
  const [view, setView]         = useState("kanban");
  const [filterCh, setFilterCh] = useState("Todos");
  const [drag, setDrag]         = useState(null);
  const [editId, setEditId]     = useState(null);
  const [form, setForm]         = useState(EMPTY);
  const [detail, setDetail]     = useState(null);

  // ── Fetch from Sheet ──
  async function fetchSheet() {
    if (!SHEET_URL) return;
    try {
      const r = await fetch(SHEET_URL + "&t=" + Date.now());
      const text = await r.text();
      const parsed = parseCSV(text);
      setLeads(prev => {
        // Merge: keep local edits for leads not yet in sheet (new ones added via form)
        const sheetIds = new Set(parsed.map(l => l.id));
        const localOnly = prev.filter(l => typeof l.id === "number" && !sheetIds.has(l.id));
        return [...parsed, ...localOnly];
      });
      setLastSync(new Date());
    } catch (e) {
      console.error("Error leyendo el Sheet:", e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchSheet();
    const interval = setInterval(fetchSheet, 5 * 60 * 1000); // refresh every 5 min
    return () => clearInterval(interval);
  }, []);

  const filtered = useMemo(() =>
    filterCh === "Todos" ? leads : leads.filter(l => l.channel === filterCh),
  [leads, filterCh]);

  function saveForm() {
    if (!form.name.trim()) return;
    if (editId !== null) {
      setLeads(ls => ls.map(l => l.id === editId ? { ...l, ...form } : l));
      setEditId(null);
    } else {
      setLeads(ls => [...ls, { ...form, id: Date.now() }]);
    }
    setForm(EMPTY);
    setView("kanban");
  }

  function advance(id) {
    setLeads(ls => ls.map(l => {
      if (l.id !== id) return l;
      const next = NEXT[l.stage];
      return next ? { ...l, stage: next } : l;
    }));
  }

  function startEdit(lead) {
    setForm({ ...EMPTY, ...lead });
    setEditId(lead.id);
    setView("form");
  }

  const kpiData = useMemo(() => CHANNELS.map(ch => {
    const sub = leads.filter(l => l.channel === ch);
    return { ch, total: sub.length, captado: atOrPast(sub,"captado"), mandato: atOrPast(sub,"mandato"), visitas: atOrPast(sub,"visitas_inmueble"), oferta: atOrPast(sub,"oferta"), vendido: sub.filter(l=>l.stage==="vendido").length };
  }), [leads]);

  const totalRow = useMemo(() => ({
    ch:"TOTAL", total: leads.length,
    captado: atOrPast(leads,"captado"), mandato: atOrPast(leads,"mandato"),
    visitas: atOrPast(leads,"visitas_inmueble"), oferta: atOrPast(leads,"oferta"),
    vendido: leads.filter(l=>l.stage==="vendido").length
  }), [leads]);

  const RATIOS = [
    { label:"Captado → Mandato",          from:"captado",          to:"mandato",          color:"#10b981" },
    { label:"Mandato → Visitas Inmueble",  from:"mandato",          to:"visitas_inmueble", color:"#f59e0b" },
    { label:"Visitas → Oferta",            from:"visitas_inmueble", to:"oferta",           color:"#f97316" },
    { label:"Oferta → Vendido",            from:"oferta",           to:"vendido",          color:"#22c55e" },
  ];

  const detailLead = detail !== null ? leads.find(l => l.id === detail) : null;

  const inp = (key, label, type="text", ph="") => (
    <div style={{ marginBottom:12 }}>
      <label style={{ fontSize:11, color:"#64748b", fontWeight:600, display:"block", marginBottom:3 }}>{label}</label>
      <input value={form[key]||""} onChange={e=>setForm(p=>({...p,[key]:e.target.value}))} type={type} placeholder={ph}
        style={{ width:"100%", background:"#0f172a", border:"1px solid #334155", borderRadius:7, padding:"7px 10px", color:"#f1f5f9", fontSize:13, boxSizing:"border-box" }} />
    </div>
  );

  // ── Render ──
  return (
    <div style={{ fontFamily:"'Inter',sans-serif", background:"#0f172a", minHeight:"100vh", color:"#e2e8f0" }}>

      {/* Header */}
      <div style={{ background:"linear-gradient(135deg,#1e293b,#0f172a)", borderBottom:"1px solid #1e293b", padding:"14px 20px", display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:10 }}>
        <div>
          <div style={{ fontSize:18, fontWeight:700, color:"#f1f5f9" }}>🏠 CRM Inmobiliario</div>
          <div style={{ fontSize:11, color:"#64748b" }}>
            {loading ? "Cargando datos…" : lastSync ? `Actualizado: ${lastSync.toLocaleTimeString("es-ES")}` : "Sin conexión al Sheet"}
            {!loading && <button onClick={fetchSheet} style={{ marginLeft:8, background:"none", border:"none", color:"#6366f1", cursor:"pointer", fontSize:11, fontWeight:600 }}>↻ Sync</button>}
          </div>
        </div>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          {["kanban","kpis"].map(v => (
            <button key={v} onClick={()=>setView(v)} style={{ padding:"5px 14px", borderRadius:8, border:"none", cursor:"pointer", fontWeight:600, fontSize:12, background:view===v?"#6366f1":"#1e293b", color:view===v?"#fff":"#94a3b8" }}>
              {v==="kanban"?"📋 Pipeline":"📊 KPIs"}
            </button>
          ))}
          <button onClick={()=>{setEditId(null);setForm(EMPTY);setView("form");}} style={{ padding:"5px 14px", borderRadius:8, border:"none", cursor:"pointer", fontWeight:600, fontSize:12, background:"#10b981", color:"#fff" }}>+ Nuevo</button>
        </div>
      </div>

      {loading && (
        <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:200, color:"#64748b", fontSize:14 }}>
          Conectando con Google Sheets…
        </div>
      )}

      {/* KANBAN */}
      {!loading && view==="kanban" && (
        <div style={{ padding:"14px 12px 0" }}>
          <div style={{ display:"flex", gap:8, marginBottom:14, flexWrap:"wrap" }}>
            {["Todos",...CHANNELS].map(ch => (
              <button key={ch} onClick={()=>setFilterCh(ch)} style={{ padding:"3px 12px", borderRadius:20, border:"none", cursor:"pointer", fontSize:11, fontWeight:600, background:filterCh===ch?(chColor[ch]||"#6366f1"):"#1e293b", color:"#fff", opacity:filterCh===ch?1:0.6 }}>
                {ch!=="Todos"?chIcon[ch]+" ":""}{ch} ({ch==="Todos"?leads.length:leads.filter(l=>l.channel===ch).length})
              </button>
            ))}
          </div>
          <div style={{ display:"flex", gap:8, overflowX:"auto", paddingBottom:16 }}>
            {STAGES.map(stage => {
              const cols = filtered.filter(l => l.stage===stage.id);
              return (
                <div key={stage.id} onDragOver={e=>e.preventDefault()} onDrop={()=>{if(drag!==null){setLeads(ls=>ls.map(l=>l.id===drag?{...l,stage:stage.id}:l));setDrag(null);}}}
                  style={{ minWidth:190, maxWidth:190, background:"#1e293b", borderRadius:12, padding:"9px 7px", border:`1px solid ${stage.color}33`, flexShrink:0 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:5, marginBottom:8 }}>
                    <div style={{ width:9, height:9, borderRadius:"50%", background:stage.color }} />
                    <span style={{ fontSize:10, fontWeight:700, color:stage.color }}>{stage.label}</span>
                    <span style={{ marginLeft:"auto", background:stage.color+"22", color:stage.color, borderRadius:10, padding:"1px 6px", fontSize:10, fontWeight:700 }}>{cols.length}</span>
                  </div>
                  {cols.map(lead => {
                    const drop = lead.pvp_salida && lead.pvp_actual && Number(lead.pvp_actual) < Number(lead.pvp_salida);
                    return (
                      <div key={lead.id} draggable onDragStart={()=>setDrag(lead.id)}
                        style={{ background:"#0f172a", borderRadius:8, padding:"7px 9px", marginBottom:7, border:"1px solid #334155", cursor:"grab" }}>
                        <div style={{ fontWeight:600, fontSize:12, color:"#f1f5f9", marginBottom:3 }}>{lead.name}</div>
                        {lead.zone && <div style={{ fontSize:10, color:"#64748b", marginBottom:3 }}>📍 {lead.zone}</div>}
                        <div style={{ display:"flex", gap:5, marginBottom:4, flexWrap:"wrap" }}>
                          <span style={{ fontSize:10, background:chColor[lead.channel]+"22", color:chColor[lead.channel], borderRadius:5, padding:"1px 5px", fontWeight:600 }}>{chIcon[lead.channel]}</span>
                          {lead.pvp_actual && <span style={{ fontSize:10, color:"#f1f5f9", fontWeight:700 }}>{fmt(lead.pvp_actual)}</span>}
                          {drop && <span style={{ fontSize:9, color:"#f87171" }}>▼</span>}
                          {lead.dom && <span style={{ fontSize:9, color:"#94a3b8" }}>DOM:{lead.dom}d</span>}
                        </div>
                        <div style={{ fontSize:10, color:"#475569", marginBottom:5 }}>{lead.agent} · {lead.date}</div>
                        <div style={{ display:"flex", gap:3 }}>
                          <button onClick={()=>setDetail(lead.id)} style={{ flex:1, padding:"2px 0", borderRadius:5, border:"none", cursor:"pointer", fontSize:9, background:"#1e293b", color:"#94a3b8", fontWeight:600 }}>👁 Ver</button>
                          {NEXT[lead.stage] && <button onClick={()=>advance(lead.id)} style={{ flex:1, padding:"2px 0", borderRadius:5, border:"none", cursor:"pointer", fontSize:9, background:stage.color, color:"#fff", fontWeight:600 }}>▶</button>}
                          <button onClick={()=>startEdit(lead)} style={{ padding:"2px 6px", borderRadius:5, border:"none", cursor:"pointer", fontSize:9, background:"#334155", color:"#94a3b8" }}>✏️</button>
                          <button onClick={()=>setLeads(ls=>ls.filter(l=>l.id!==lead.id))} style={{ padding:"2px 6px", borderRadius:5, border:"none", cursor:"pointer", fontSize:9, background:"#450a0a", color:"#f87171" }}>✕</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* DETAIL MODAL */}
      {detailLead && (
        <div onClick={()=>setDetail(null)} style={{ position:"fixed", inset:0, background:"#000000bb", display:"flex", alignItems:"center", justifyContent:"center", zIndex:100, padding:16 }}>
          <div onClick={e=>e.stopPropagation()} style={{ background:"#1e293b", borderRadius:16, padding:24, maxWidth:520, width:"100%", maxHeight:"85vh", overflowY:"auto", border:"1px solid #334155" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
              <div style={{ fontSize:16, fontWeight:700, color:"#f1f5f9" }}>{detailLead.name}</div>
              <button onClick={()=>setDetail(null)} style={{ background:"#334155", border:"none", borderRadius:6, padding:"3px 10px", color:"#94a3b8", cursor:"pointer" }}>✕</button>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"8px 16px", fontSize:12 }}>
              {[
                ["📍 Zona", detailLead.zone], ["📞 Teléfono", detailLead.phone],
                ["👤 Agente", detailLead.agent], ["📅 Captación", detailLead.date],
                ["📡 Canal", `${chIcon[detailLead.channel]} ${detailLead.channel}`],
                ["🔖 Etapa", STAGES.find(s=>s.id===detailLead.stage)?.label],
                ["💰 PVP Salida", fmt(detailLead.pvp_salida)], ["💰 PVP Actual", fmt(detailLead.pvp_actual)],
                ["📆 Últ. publicación", detailLead.fecha_pub||"—"], ["⏱ DOM", detailLead.dom?detailLead.dom+"d":"—"],
                ["🎥 Vídeo", detailLead.video], ["📐 Plano", detailLead.plano],
              ].map(([k,v])=>(
                <div key={k}><div style={{ color:"#64748b", fontSize:10, fontWeight:600 }}>{k}</div><div style={{ color:"#f1f5f9", fontWeight:600 }}>{v||"—"}</div></div>
              ))}
            </div>
            {detailLead.notes && <div style={{ marginTop:14, background:"#0f172a", borderRadius:8, padding:10 }}><div style={{ color:"#64748b", fontSize:10, fontWeight:600, marginBottom:4 }}>📝 NOTAS</div><div style={{ color:"#cbd5e1", fontSize:12 }}>{detailLead.notes}</div></div>}
            <div style={{ marginTop:12, display:"flex", gap:8, flexWrap:"wrap" }}>
              {detailLead.link_anuncio && <a href={detailLead.link_anuncio} target="_blank" rel="noreferrer" style={{ fontSize:11, color:"#6366f1", textDecoration:"none", background:"#6366f122", borderRadius:6, padding:"4px 10px" }}>🔗 Ver anuncio</a>}
              {detailLead.link_dashboard && <a href={detailLead.link_dashboard} target="_blank" rel="noreferrer" style={{ fontSize:11, color:"#10b981", textDecoration:"none", background:"#10b98122", borderRadius:6, padding:"4px 10px" }}>📊 propdata</a>}
            </div>
            <div style={{ marginTop:12, display:"flex", gap:8 }}>
              <button onClick={()=>{startEdit(detailLead);setDetail(null);}} style={{ flex:1, padding:"7px 0", borderRadius:8, border:"none", cursor:"pointer", fontSize:12, background:"#6366f1", color:"#fff", fontWeight:600 }}>✏️ Editar</button>
              {NEXT[detailLead.stage] && <button onClick={()=>{advance(detailLead.id);setDetail(null);}} style={{ flex:1, padding:"7px 0", borderRadius:8, border:"none", cursor:"pointer", fontSize:12, background:"#10b981", color:"#fff", fontWeight:600 }}>▶ Avanzar</button>}
            </div>
          </div>
        </div>
      )}

      {/* KPIs */}
      {!loading && view==="kpis" && (
        <div style={{ padding:20 }}>
          <div style={{ display:"flex", gap:10, marginBottom:24, flexWrap:"wrap" }}>
            {[
              {label:"Total Leads", value:leads.length, color:"#6366f1"},
              {label:"Mandatos",    value:atOrPast(leads,"mandato"), color:"#10b981"},
              {label:"Con Visitas", value:atOrPast(leads,"visitas_inmueble"), color:"#f59e0b"},
              {label:"Ofertas",     value:atOrPast(leads,"oferta"), color:"#f97316"},
              {label:"Vendidos",    value:leads.filter(l=>l.stage==="vendido").length, color:"#22c55e"},
            ].map(c=>(
              <div key={c.label} style={{ background:"#1e293b", borderRadius:12, padding:"14px 20px", border:`1px solid ${c.color}44`, minWidth:110 }}>
                <div style={{ fontSize:26, fontWeight:800, color:c.color }}>{c.value}</div>
                <div style={{ fontSize:10, color:"#64748b", fontWeight:600 }}>{c.label}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize:13, fontWeight:700, color:"#f1f5f9", marginBottom:12 }}>Ratios Clave</div>
          <div style={{ display:"flex", gap:10, marginBottom:24, flexWrap:"wrap" }}>
            {RATIOS.map(r=>{
              const fromC = atOrPast(leads,r.from);
              const toC   = r.to==="vendido"?leads.filter(l=>l.stage==="vendido").length:atOrPast(leads,r.to);
              const v = pctVal(toC,fromC);
              return (
                <div key={r.label} style={{ background:"#1e293b", borderRadius:12, padding:"14px 18px", border:`1px solid ${r.color}44`, flex:1, minWidth:180 }}>
                  <div style={{ fontSize:10, color:"#64748b", fontWeight:600, marginBottom:6 }}>{r.label}</div>
                  <div style={{ fontSize:28, fontWeight:800, color:r.color, marginBottom:6 }}>{pct(toC,fromC)}</div>
                  <div style={{ background:"#0f172a", borderRadius:5, height:6, overflow:"hidden", marginBottom:4 }}>
                    <div style={{ width:`${v}%`, height:"100%", background:r.color, borderRadius:5 }} />
                  </div>
                  <div style={{ fontSize:10, color:"#475569" }}>{toC} de {fromC}</div>
                </div>
              );
            })}
          </div>
          <div style={{ fontSize:13, fontWeight:700, color:"#f1f5f9", marginBottom:12 }}>Desglose por Canal</div>
          <div style={{ background:"#1e293b", borderRadius:12, overflow:"hidden" }}>
            <div style={{ overflowX:"auto" }}>
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:11 }}>
                <thead>
                  <tr style={{ background:"#0f172a" }}>
                    {["Canal","Leads","Mandatos","Cap→Mand","Visitas","Mand→Vis","Ofertas","Vis→Of","Vendidos","Of→Venta"].map(h=>(
                      <th key={h} style={{ padding:"9px 10px", textAlign:h==="Canal"?"left":"center", color:"#64748b", fontWeight:700, fontSize:9, textTransform:"uppercase", whiteSpace:"nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...kpiData,{...totalRow,_t:true}].map((row,i)=>(
                    <tr key={row.ch} style={{ borderTop:"1px solid #334155", background:row._t?"#6366f111":i%2===0?"transparent":"#ffffff04" }}>
                      <td style={{ padding:"9px 10px", fontWeight:700 }}>{row._t?<span style={{color:"#f1f5f9"}}>TOTAL</span>:<span style={{color:chColor[row.ch]}}>{chIcon[row.ch]} {row.ch}</span>}</td>
                      <td style={{ textAlign:"center",color:"#f1f5f9" }}>{row.total}</td>
                      <td style={{ textAlign:"center",color:"#10b981" }}>{row.mandato}</td>
                      <PC a={row.mandato} b={row.captado}  c="#10b981"/>
                      <td style={{ textAlign:"center",color:"#f59e0b" }}>{row.visitas}</td>
                      <PC a={row.visitas} b={row.mandato}  c="#f59e0b"/>
                      <td style={{ textAlign:"center",color:"#f97316" }}>{row.oferta}</td>
                      <PC a={row.oferta}  b={row.visitas}  c="#f97316"/>
                      <td style={{ textAlign:"center",color:"#22c55e" }}>{row.vendido}</td>
                      <PC a={row.vendido} b={row.oferta}   c="#22c55e"/>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* FORM */}
      {view==="form" && (
        <div style={{ padding:20, maxWidth:560 }}>
          <div style={{ fontSize:15, fontWeight:700, color:"#f1f5f9", marginBottom:16 }}>{editId!==null?"✏️ Editar":"➕ Nuevo Lead"}</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0 12px" }}>
            {inp("name","Nombre *")} {inp("phone","Teléfono","tel")}
            {inp("zone","Zona / Calle")} {inp("agent","Agente *")}
            {inp("date","Fecha captación","date")} {inp("pvp_salida","PVP Salida (€)","number")}
            {inp("pvp_actual","PVP Actual (€)","number")} {inp("fecha_pub","Fecha últ. pub.","date")}
            {inp("link_anuncio","Link Anuncio")} {inp("link_dashboard","Link Dashboard")}
          </div>
          <div style={{ marginBottom:12 }}>
            <label style={{ fontSize:11, color:"#64748b", fontWeight:600, display:"block", marginBottom:3 }}>Canal</label>
            <div style={{ display:"flex", gap:8 }}>
              {CHANNELS.map(ch=>(
                <button key={ch} onClick={()=>setForm(p=>({...p,channel:ch}))} style={{ flex:1, padding:"7px 0", borderRadius:7, border:"none", cursor:"pointer", fontWeight:600, fontSize:11, background:form.channel===ch?chColor[ch]:"#1e293b", color:"#fff" }}>{chIcon[ch]} {ch}</button>
              ))}
            </div>
          </div>
          <div style={{ marginBottom:12 }}>
            <label style={{ fontSize:11, color:"#64748b", fontWeight:600, display:"block", marginBottom:3 }}>Etapa</label>
            <select value={form.stage} onChange={e=>setForm(p=>({...p,stage:e.target.value}))} style={{ width:"100%", background:"#0f172a", border:"1px solid #334155", borderRadius:7, padding:"7px 10px", color:"#f1f5f9", fontSize:12 }}>
              {STAGES.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0 12px", marginBottom:12 }}>
            {[["video","Vídeo"],["plano","Plano"]].map(([k,l])=>(
              <div key={k}>
                <label style={{ fontSize:11, color:"#64748b", fontWeight:600, display:"block", marginBottom:3 }}>{l}</label>
                <select value={form[k]||"N"} onChange={e=>setForm(p=>({...p,[k]:e.target.value}))} style={{ width:"100%", background:"#0f172a", border:"1px solid #334155", borderRadius:7, padding:"7px 10px", color:"#f1f5f9", fontSize:12 }}>
                  <option value="N">No</option><option value="S">Sí</option>
                </select>
              </div>
            ))}
          </div>
          <div style={{ marginBottom:16 }}>
            <label style={{ fontSize:11, color:"#64748b", fontWeight:600, display:"block", marginBottom:3 }}>Notas</label>
            <textarea value={form.notes||""} onChange={e=>setForm(p=>({...p,notes:e.target.value}))} rows={3} style={{ width:"100%", background:"#0f172a", border:"1px solid #334155", borderRadius:7, padding:"7px 10px", color:"#f1f5f9", fontSize:12, boxSizing:"border-box", resize:"vertical" }} />
          </div>
          <div style={{ display:"flex", gap:10 }}>
            <button onClick={saveForm} style={{ flex:1, padding:"9px 0", borderRadius:8, border:"none", cursor:"pointer", fontWeight:700, fontSize:13, background:"#6366f1", color:"#fff" }}>{editId!==null?"Guardar":"Crear lead"}</button>
            <button onClick={()=>setView("kanban")} style={{ padding:"9px 18px", borderRadius:8, border:"none", cursor:"pointer", fontWeight:600, fontSize:13, background:"#1e293b", color:"#94a3b8" }}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
}

function PC({a,b,c}){
  const v=b===0?0:Math.round((a/b)*100);
  return <td style={{textAlign:"center"}}><span style={{background:c+"22",color:c,borderRadius:5,padding:"2px 7px",fontWeight:700,fontSize:10}}>{b===0?"—":`${v}%`}</span></td>;
}
