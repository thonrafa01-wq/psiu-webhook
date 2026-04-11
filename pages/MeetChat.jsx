import { useState, useEffect, useRef, useCallback } from "react";
import { Sala, Mensagem, UsuarioSala, AgenteIA } from "@/api/entities";
import { agentReply } from "@/api/backendFunctions";

// ── Utilitários ───────────────────────────────────────────────────────────────
const CORES = ["#6366f1","#ec4899","#10b981","#f59e0b","#3b82f6","#ef4444","#8b5cf6","#14b8a6"];
const hashCor = (nome) => CORES[nome?.split("").reduce((a,c)=>a+c.charCodeAt(0),0) % CORES.length] || CORES[0];
const iniciais = (nome) => (nome||"?").split(" ").map(p=>p[0]).join("").toUpperCase().slice(0,2);
const fmtHora = (iso) => { try { return new Date(iso).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"}); } catch { return ""; } };
const fmtData = (iso) => { try { const d=new Date(iso); const h=new Date(); return d.toDateString()===h.toDateString()?"Hoje":d.toLocaleDateString("pt-BR"); } catch { return ""; } };
function simpleHash(str) { let h=0; for(let i=0;i<str.length;i++) h=(Math.imul(31,h)+str.charCodeAt(i))|0; return Math.abs(h).toString(36); }

// ── Avatar ────────────────────────────────────────────────────────────────────
function Avatar({ nome, emoji, size=36, cor }) {
  const bg = cor || hashCor(nome);
  if (emoji) return (
    <div style={{width:size,height:size,borderRadius:"50%",background:bg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:size*0.5,flexShrink:0}}>
      {emoji}
    </div>
  );
  return (
    <div style={{width:size,height:size,borderRadius:"50%",background:bg,display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:700,fontSize:size*0.36,flexShrink:0}}>
      {iniciais(nome)}
    </div>
  );
}

// ── Tela de Login ─────────────────────────────────────────────────────────────
function LoginScreen({ onLogin }) {
  const [modo, setModo] = useState("login");
  const [nome, setNome] = useState("");
  const [senha, setSenha] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [erro, setErro] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!nome.trim() || !senha.trim()) return setErro("Preencha todos os campos.");
    setLoading(true); setErro("");
    try {
      if (modo === "cadastro") {
        if (senha !== confirmar) { setErro("As senhas não coincidem."); setLoading(false); return; }
        if (senha.length < 4) { setErro("Senha deve ter ao menos 4 caracteres."); setLoading(false); return; }
        const existe = await UsuarioSala.filter({ nome: nome.trim() });
        if (existe.length > 0) { setErro("Este nome já está em uso."); setLoading(false); return; }
        const senhaHash = simpleHash(senha);
        const token = simpleHash(nome + Date.now());
        const novo = await UsuarioSala.create({ nome: nome.trim(), senha_hash: senhaHash, token, online: true, ultimo_ping: new Date().toISOString(), papel: "membro", avatar_cor: hashCor(nome.trim()) });
        localStorage.setItem("meet_token", token);
        localStorage.setItem("meet_user", JSON.stringify(novo));
        onLogin(novo);
      } else {
        const lista = await UsuarioSala.filter({ nome: nome.trim() });
        if (lista.length === 0) { setErro("Usuário não encontrado."); setLoading(false); return; }
        const user = lista[0];
        if (user.senha_hash !== simpleHash(senha)) { setErro("Senha incorreta."); setLoading(false); return; }
        const token = simpleHash(nome + Date.now());
        await UsuarioSala.update(user.id, { online: true, ultimo_ping: new Date().toISOString(), token });
        const atualizado = { ...user, online: true, token };
        localStorage.setItem("meet_token", token);
        localStorage.setItem("meet_user", JSON.stringify(atualizado));
        onLogin(atualizado);
      }
    } catch(e) { setErro("Erro: " + e.message); }
    setLoading(false);
  }

  return (
    <div style={{minHeight:"100vh",background:"linear-gradient(135deg,#1e1b4b 0%,#312e81 50%,#1e1b4b 100%)",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Segoe UI',sans-serif"}}>
      <div style={{background:"rgba(255,255,255,0.07)",backdropFilter:"blur(20px)",borderRadius:24,padding:"40px 36px",width:"100%",maxWidth:400,border:"1px solid rgba(255,255,255,0.15)",boxShadow:"0 25px 50px rgba(0,0,0,0.4)"}}>
        <div style={{textAlign:"center",marginBottom:32}}>
          <div style={{fontSize:52,marginBottom:8}}>🚀</div>
          <h1 style={{color:"#fff",fontSize:26,fontWeight:800,margin:0}}>MeetSpace</h1>
          <p style={{color:"rgba(255,255,255,0.5)",fontSize:14,marginTop:4}}>Reuniões & Chat com IA</p>
        </div>
        <div style={{display:"flex",gap:4,background:"rgba(0,0,0,0.3)",borderRadius:12,padding:4,marginBottom:24}}>
          {["login","cadastro"].map(m=>(
            <button key={m} onClick={()=>{setModo(m);setErro("");}} style={{flex:1,padding:"10px",border:"none",borderRadius:10,cursor:"pointer",fontWeight:600,fontSize:14,transition:"all .2s",background:modo===m?"#6366f1":"transparent",color:modo===m?"#fff":"rgba(255,255,255,0.5)"}}>
              {m==="login"?"Entrar":"Criar conta"}
            </button>
          ))}
        </div>
        <form onSubmit={handleSubmit} style={{display:"flex",flexDirection:"column",gap:14}}>
          <input value={nome} onChange={e=>setNome(e.target.value)} placeholder="Seu nome" style={{padding:"12px 16px",borderRadius:12,border:"1px solid rgba(255,255,255,0.2)",background:"rgba(255,255,255,0.1)",color:"#fff",fontSize:15,outline:"none"}} />
          <input type="password" value={senha} onChange={e=>setSenha(e.target.value)} placeholder="Senha" style={{padding:"12px 16px",borderRadius:12,border:"1px solid rgba(255,255,255,0.2)",background:"rgba(255,255,255,0.1)",color:"#fff",fontSize:15,outline:"none"}} />
          {modo==="cadastro" && <input type="password" value={confirmar} onChange={e=>setConfirmar(e.target.value)} placeholder="Confirmar senha" style={{padding:"12px 16px",borderRadius:12,border:"1px solid rgba(255,255,255,0.2)",background:"rgba(255,255,255,0.1)",color:"#fff",fontSize:15,outline:"none"}} />}
          {erro && <div style={{background:"rgba(239,68,68,0.2)",border:"1px solid rgba(239,68,68,0.4)",borderRadius:10,padding:"10px 14px",color:"#fca5a5",fontSize:13}}>{erro}</div>}
          <button type="submit" disabled={loading} style={{padding:"14px",borderRadius:12,border:"none",background:"linear-gradient(135deg,#6366f1,#8b5cf6)",color:"#fff",fontWeight:700,fontSize:16,cursor:"pointer",opacity:loading?0.7:1,marginTop:4}}>
            {loading?"Aguarde...":(modo==="login"?"Entrar":"Criar conta")}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Bolha de Mensagem ─────────────────────────────────────────────────────────
function BolhaMensagem({ msg, minha, usuarios, agentes }) {
  const isAgente = msg.autor_tipo === "agente";
  const isSistema = msg.autor_tipo === "sistema";
  const agente = agentes.find(a=>a.nome===msg.autor_nome);
  const cor = agente?.cor || hashCor(msg.autor_nome);

  if (isSistema) return (
    <div style={{textAlign:"center",margin:"8px 0"}}>
      <span style={{background:"rgba(255,255,255,0.08)",color:"rgba(255,255,255,0.4)",fontSize:12,padding:"4px 12px",borderRadius:20}}>{msg.conteudo}</span>
    </div>
  );

  return (
    <div style={{display:"flex",gap:10,alignItems:"flex-start",flexDirection:minha?"row-reverse":"row",margin:"4px 0"}}>
      <Avatar nome={msg.autor_nome} emoji={isAgente?agente?.avatar_emoji:null} size={34} cor={minha?"#6366f1":cor} />
      <div style={{maxWidth:"72%",minWidth:60}}>
        {!minha && <div style={{fontSize:12,fontWeight:600,color:isAgente?cor:"rgba(255,255,255,0.6)",marginBottom:3}}>{msg.autor_nome}{isAgente&&<span style={{fontSize:10,background:"rgba(99,102,241,0.3)",color:"#a5b4fc",borderRadius:6,padding:"1px 6px",marginLeft:6}}>IA</span>}</div>}
        <div style={{background:minha?"linear-gradient(135deg,#6366f1,#8b5cf6)":isAgente?"rgba(99,102,241,0.15)":"rgba(255,255,255,0.08)",border:isAgente?"1px solid rgba(99,102,241,0.3)":"1px solid rgba(255,255,255,0.06)",borderRadius:minha?"18px 4px 18px 18px":"4px 18px 18px 18px",padding:"10px 14px",color:"#fff",fontSize:14,lineHeight:1.5,wordBreak:"break-word",whiteSpace:"pre-wrap"}}>
          {msg.conteudo}
        </div>
        <div style={{fontSize:11,color:"rgba(255,255,255,0.3)",marginTop:3,textAlign:minha?"right":"left"}}>{fmtHora(msg.created_date)}</div>
      </div>
    </div>
  );
}

// ── Chat Principal ────────────────────────────────────────────────────────────
function ChatArea({ sala, usuario, usuarios, agentes, dmAlvo, onVoltar }) {
  const [mensagens, setMensagens] = useState([]);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [agentePensando, setAgentePensando] = useState(false);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const pollRef = useRef(null);

  const isDM = !!dmAlvo;
  const titulo = isDM ? dmAlvo.nome : sala?.nome;
  const dmSalaId = isDM ? ["dm", [usuario.nome, dmAlvo.nome].sort().join("_")].join("_") : null;
  const salaIdAtual = isDM ? dmSalaId : sala?.id;

  const carregar = useCallback(async () => {
    if (!salaIdAtual) return;
    try {
      const all = await Mensagem.filter({ sala_id: salaIdAtual });
      const sorted = all.sort((a,b)=>new Date(a.created_date)-new Date(b.created_date));
      setMensagens(prev => {
        if (JSON.stringify(prev.map(m=>m.id)) !== JSON.stringify(sorted.map(m=>m.id))) return sorted;
        return prev;
      });
    } catch {}
  }, [salaIdAtual]);

  useEffect(() => {
    carregar();
    pollRef.current = setInterval(carregar, 2000);
    return () => clearInterval(pollRef.current);
  }, [carregar]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [mensagens]);

  async function enviar() {
    if (!texto.trim() || enviando) return;
    const conteudo = texto.trim();
    setTexto(""); setEnviando(true);
    try {
      await Mensagem.create({ sala_id: salaIdAtual, autor_nome: usuario.nome, autor_tipo: "humano", conteudo, tipo: isDM?"dm":"texto", dm_para: isDM?dmAlvo.nome:null, dm_de: isDM?usuario.nome:null, lida: false });
      await carregar();

      // Chamar agentes se não for DM
      if (!isDM && agentes.length > 0) {
        const agentesSala = agentes.filter(ag => (sala?.agentes_ativos||[]).includes(ag.nome));
        const temMencao = agentesSala.some(ag => conteudo.toLowerCase().includes(ag.trigger) || conteudo.toLowerCase().includes("@"+ag.nome.toLowerCase()));
        if (temMencao) {
          setAgentePensando(true);
          try {
            await agentReply({ mensagem: conteudo, sala_id: salaIdAtual, autor_nome: usuario.nome, agentes: agentesSala, historico: mensagens.slice(-10) });
            await carregar();
          } catch(e) { console.error(e); }
          setAgentePensando(false);
        }
      }
    } catch(e) { console.error(e); }
    setEnviando(false);
    inputRef.current?.focus();
  }

  function onKeyDown(e) { if (e.key==="Enter" && !e.shiftKey) { e.preventDefault(); enviar(); } }

  // Agrupar mensagens por data
  const grupos = mensagens.reduce((acc, m) => {
    const data = fmtData(m.created_date);
    if (!acc[data]) acc[data] = [];
    acc[data].push(m);
    return acc;
  }, {});

  const agentesSala = agentes.filter(ag => !isDM && (sala?.agentes_ativos||[]).includes(ag.nome));

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",height:"100%",overflow:"hidden"}}>
      {/* Header */}
      <div style={{padding:"14px 20px",borderBottom:"1px solid rgba(255,255,255,0.08)",display:"flex",alignItems:"center",gap:12,background:"rgba(0,0,0,0.2)",flexShrink:0}}>
        {onVoltar && <button onClick={onVoltar} style={{background:"none",border:"none",color:"rgba(255,255,255,0.5)",cursor:"pointer",fontSize:20,padding:0}}>←</button>}
        <Avatar nome={isDM?dmAlvo.nome:sala?.nome} emoji={isDM?null:null} size={38} cor={isDM?hashCor(dmAlvo.nome):"#6366f1"} />
        <div>
          <div style={{color:"#fff",fontWeight:700,fontSize:16}}>{titulo}</div>
          <div style={{color:"rgba(255,255,255,0.4)",fontSize:12}}>
            {isDM ? (dmAlvo.online?"🟢 online":"⚫ offline") : `${agentesSala.length} agente${agentesSala.length!==1?"s":""} ativo${agentesSala.length!==1?"s":""}`}
          </div>
        </div>
        {!isDM && agentesSala.length > 0 && (
          <div style={{marginLeft:"auto",display:"flex",gap:6}}>
            {agentesSala.map(ag=>(
              <div key={ag.id} title={ag.nome} style={{display:"flex",alignItems:"center",gap:5,background:"rgba(99,102,241,0.2)",border:"1px solid rgba(99,102,241,0.3)",borderRadius:20,padding:"3px 10px"}}>
                <span style={{fontSize:14}}>{ag.avatar_emoji}</span>
                <span style={{color:"#a5b4fc",fontSize:12,fontWeight:600}}>{ag.nome}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Mensagens */}
      <div style={{flex:1,overflowY:"auto",padding:"16px 20px",display:"flex",flexDirection:"column",gap:2}}>
        {mensagens.length === 0 && (
          <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",color:"rgba(255,255,255,0.2)",gap:12}}>
            <div style={{fontSize:48}}>{isDM?"💬":"🚀"}</div>
            <div style={{fontSize:15}}>{isDM?`Comece uma conversa com ${dmAlvo.nome}`:`Seja o primeiro a falar em #${sala?.nome}`}</div>
            {!isDM && agentesSala.length>0 && <div style={{fontSize:13,color:"rgba(99,102,241,0.6)"}}>Mencione {agentesSala.map(a=>"@"+a.nome).join(", ")} para chamar um agente</div>}
          </div>
        )}
        {Object.entries(grupos).map(([data, msgs]) => (
          <div key={data}>
            <div style={{textAlign:"center",margin:"12px 0 8px"}}>
              <span style={{background:"rgba(255,255,255,0.06)",color:"rgba(255,255,255,0.35)",fontSize:12,padding:"3px 12px",borderRadius:20}}>{data}</span>
            </div>
            {msgs.map(m=>(
              <BolhaMensagem key={m.id} msg={m} minha={m.autor_nome===usuario.nome} usuarios={usuarios} agentes={agentes} />
            ))}
          </div>
        ))}
        {agentePensando && (
          <div style={{display:"flex",gap:10,alignItems:"center",padding:"8px 0"}}>
            <div style={{width:34,height:34,borderRadius:"50%",background:"#6366f1",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16}}>🤖</div>
            <div style={{background:"rgba(99,102,241,0.15)",border:"1px solid rgba(99,102,241,0.3)",borderRadius:"4px 18px 18px 18px",padding:"10px 16px",display:"flex",gap:6}}>
              {[0,1,2].map(i=><div key={i} style={{width:7,height:7,borderRadius:"50%",background:"#818cf8",animation:`pulse 1.2s ${i*0.2}s infinite`}}/>)}
            </div>
          </div>
        )}
        <div ref={bottomRef}/>
      </div>

      {/* Input */}
      <div style={{padding:"12px 16px",borderTop:"1px solid rgba(255,255,255,0.08)",background:"rgba(0,0,0,0.2)",flexShrink:0}}>
        {!isDM && agentesSala.length>0 && (
          <div style={{fontSize:11,color:"rgba(99,102,241,0.6)",marginBottom:6,paddingLeft:4}}>
            💡 Mencione {agentesSala.map(a=>"@"+a.nome).join(", ")} para interagir com os agentes
          </div>
        )}
        <div style={{display:"flex",gap:10,alignItems:"flex-end"}}>
          <textarea value={texto} onChange={e=>setTexto(e.target.value)} onKeyDown={onKeyDown} ref={inputRef} placeholder={isDM?`Mensagem para ${dmAlvo.nome}...`:`Mensagem em #${sala?.nome}...`} rows={1} style={{flex:1,padding:"12px 16px",borderRadius:16,border:"1px solid rgba(255,255,255,0.15)",background:"rgba(255,255,255,0.07)",color:"#fff",fontSize:14,outline:"none",resize:"none",fontFamily:"inherit",lineHeight:1.5,maxHeight:120,overflowY:"auto"}} onInput={e=>{e.target.style.height="auto";e.target.style.height=Math.min(e.target.scrollHeight,120)+"px";}} />
          <button onClick={enviar} disabled={!texto.trim()||enviando} style={{width:44,height:44,borderRadius:"50%",border:"none",background:"linear-gradient(135deg,#6366f1,#8b5cf6)",color:"#fff",fontSize:20,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",opacity:!texto.trim()||enviando?0.4:1,flexShrink:0}}>
            ➤
          </button>
        </div>
      </div>
    </div>
  );
}

// ── App Principal ─────────────────────────────────────────────────────────────
export default function MeetChat() {
  const [usuario, setUsuario] = useState(null);
  const [salas, setSalas] = useState([]);
  const [usuarios, setUsuarios] = useState([]);
  const [agentes, setAgentes] = useState([]);
  const [salaAtiva, setSalaAtiva] = useState(null);
  const [dmAlvo, setDmAlvo] = useState(null);
  const [aba, setAba] = useState("salas"); // salas | pessoas | agentes
  const [novaSala, setNovaSala] = useState(false);
  const [nomeSala, setNomeSala] = useState("");
  const [descSala, setDescSala] = useState("");
  const [tipoSala, setTipoSala] = useState("publica");
  const [agentesSala, setAgentesSala] = useState([]);
  const [criandoSala, setCriandoSala] = useState(false);
  const [sidebarAberta, setSidebarAberta] = useState(true);
  const pingRef = useRef(null);

  // Tentar restaurar sessão
  useEffect(() => {
    const token = localStorage.getItem("meet_token");
    const saved = localStorage.getItem("meet_user");
    if (token && saved) { try { setUsuario(JSON.parse(saved)); } catch {} }
  }, []);

  useEffect(() => {
    if (!usuario) return;
    carregarDados();
    const interval = setInterval(carregarDados, 5000);
    // Ping de presença
    pingRef.current = setInterval(() => {
      UsuarioSala.update(usuario.id, { online: true, ultimo_ping: new Date().toISOString() }).catch(()=>{});
    }, 15000);
    return () => { clearInterval(interval); clearInterval(pingRef.current); };
  }, [usuario]);

  // Marcar offline ao sair
  useEffect(() => {
    const handle = () => { if (usuario) UsuarioSala.update(usuario.id, { online: false }).catch(()=>{}); };
    window.addEventListener("beforeunload", handle);
    return () => window.removeEventListener("beforeunload", handle);
  }, [usuario]);

  async function carregarDados() {
    const [ss, us, as] = await Promise.all([
      Sala.filter({ ativa: true }),
      UsuarioSala.list(),
      AgenteIA.filter({ ativo: true })
    ]);
    setSalas(ss.sort((a,b)=>a.nome.localeCompare(b.nome)));
    setUsuarios(us);
    setAgentes(as);
    // Marcar offline usuários que não pingaram há mais de 45s
    const agora = Date.now();
    for (const u of us) {
      if (u.id !== usuario?.id && u.online && u.ultimo_ping) {
        if (agora - new Date(u.ultimo_ping).getTime() > 45000) {
          UsuarioSala.update(u.id, { online: false }).catch(()=>{});
        }
      }
    }
  }

  function logout() {
    if (usuario) UsuarioSala.update(usuario.id, { online: false }).catch(()=>{});
    localStorage.removeItem("meet_token");
    localStorage.removeItem("meet_user");
    setUsuario(null); setSalaAtiva(null); setDmAlvo(null);
  }

  async function entrarSala(sala) {
    setSalaAtiva(sala); setDmAlvo(null);
    await UsuarioSala.update(usuario.id, { sala_atual: sala.id }).catch(()=>{});
  }

  async function abrirDM(alvo) {
    setDmAlvo(alvo); setSalaAtiva(null);
  }

  async function criarSala() {
    if (!nomeSala.trim()) return;
    setCriandoSala(true);
    try {
      const nova = await Sala.create({ nome: nomeSala.trim(), descricao: descSala.trim(), criador: usuario.nome, tipo: tipoSala, ativa: true, agentes_ativos: agentesSala, participantes: [] });
      await Mensagem.create({ sala_id: nova.id, autor_nome: "sistema", autor_tipo: "sistema", conteudo: `Sala criada por ${usuario.nome}`, tipo: "sistema" });
      setNomeSala(""); setDescSala(""); setTipoSala("publica"); setAgentesSala([]); setNovaSala(false);
      await carregarDados();
      setSalaAtiva(nova);
    } catch(e) { alert("Erro ao criar sala: "+e.message); }
    setCriandoSala(false);
  }

  if (!usuario) return <LoginScreen onLogin={u=>{setUsuario(u);}} />;

  const outrosUsuarios = usuarios.filter(u=>u.id!==usuario.id);
  const onlineCount = outrosUsuarios.filter(u=>u.online).length;

  return (
    <div style={{height:"100vh",display:"flex",background:"#0f0e1a",fontFamily:"'Segoe UI',sans-serif",overflow:"hidden",color:"#fff"}}>
      <style>{`
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 4px; }
        @keyframes pulse { 0%,100%{opacity:.3;transform:scale(.8)} 50%{opacity:1;transform:scale(1)} }
        input::placeholder, textarea::placeholder { color: rgba(255,255,255,0.3) !important; }
        input, textarea { caret-color: #a5b4fc; }
      `}</style>

      {/* Sidebar */}
      <div style={{width:sidebarAberta?280:60,transition:"width .3s",background:"rgba(255,255,255,0.03)",borderRight:"1px solid rgba(255,255,255,0.07)",display:"flex",flexDirection:"column",flexShrink:0,overflow:"hidden"}}>
        {/* Logo + toggle */}
        <div style={{padding:"16px 14px",borderBottom:"1px solid rgba(255,255,255,0.07)",display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:36,height:36,borderRadius:10,background:"linear-gradient(135deg,#6366f1,#8b5cf6)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>🚀</div>
          {sidebarAberta && <span style={{fontWeight:800,fontSize:17,color:"#fff",flex:1}}>MeetSpace</span>}
          <button onClick={()=>setSidebarAberta(!sidebarAberta)} style={{background:"none",border:"none",color:"rgba(255,255,255,0.4)",cursor:"pointer",fontSize:18,padding:0,flexShrink:0}}>
            {sidebarAberta?"◀":"▶"}
          </button>
        </div>

        {sidebarAberta && (
          <>
            {/* Abas */}
            <div style={{display:"flex",padding:"10px 10px 0",gap:4}}>
              {[["salas","# Salas"],["pessoas","👥 Pessoas"],["agentes","🤖 Agentes"]].map(([k,l])=>(
                <button key={k} onClick={()=>setAba(k)} style={{flex:1,padding:"7px 4px",border:"none",borderRadius:8,cursor:"pointer",fontSize:11,fontWeight:600,background:aba===k?"rgba(99,102,241,0.3)":"transparent",color:aba===k?"#a5b4fc":"rgba(255,255,255,0.4)"}}>
                  {l}
                </button>
              ))}
            </div>

            <div style={{flex:1,overflowY:"auto",padding:"8px 8px"}}>
              {/* ABA: SALAS */}
              {aba==="salas" && (
                <div>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"6px 6px 8px"}}>
                    <span style={{fontSize:11,color:"rgba(255,255,255,0.35)",fontWeight:600,letterSpacing:1}}>SALAS ({salas.length})</span>
                    <button onClick={()=>setNovaSala(!novaSala)} style={{background:"rgba(99,102,241,0.2)",border:"none",color:"#a5b4fc",borderRadius:6,cursor:"pointer",fontSize:16,width:22,height:22,display:"flex",alignItems:"center",justifyContent:"center"}}>+</button>
                  </div>
                  {novaSala && (
                    <div style={{background:"rgba(99,102,241,0.1)",border:"1px solid rgba(99,102,241,0.3)",borderRadius:12,padding:12,marginBottom:8,display:"flex",flexDirection:"column",gap:8}}>
                      <input value={nomeSala} onChange={e=>setNomeSala(e.target.value)} placeholder="Nome da sala" style={{padding:"8px 10px",borderRadius:8,border:"1px solid rgba(255,255,255,0.15)",background:"rgba(255,255,255,0.07)",color:"#fff",fontSize:13,outline:"none"}} />
                      <input value={descSala} onChange={e=>setDescSala(e.target.value)} placeholder="Descrição (opcional)" style={{padding:"8px 10px",borderRadius:8,border:"1px solid rgba(255,255,255,0.15)",background:"rgba(255,255,255,0.07)",color:"#fff",fontSize:13,outline:"none"}} />
                      <div style={{fontSize:12,color:"rgba(255,255,255,0.4)",marginBottom:2}}>Agentes:</div>
                      {agentes.map(ag=>(
                        <label key={ag.id} style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer"}}>
                          <input type="checkbox" checked={agentesSala.includes(ag.nome)} onChange={e=>setAgentesSala(prev=>e.target.checked?[...prev,ag.nome]:prev.filter(n=>n!==ag.nome))} style={{accentColor:"#6366f1"}} />
                          <span style={{fontSize:13,color:"rgba(255,255,255,0.7)"}}>{ag.avatar_emoji} {ag.nome}</span>
                        </label>
                      ))}
                      <div style={{display:"flex",gap:6}}>
                        <button onClick={criarSala} disabled={!nomeSala.trim()||criandoSala} style={{flex:1,padding:"8px",borderRadius:8,border:"none",background:"#6366f1",color:"#fff",fontWeight:600,fontSize:13,cursor:"pointer",opacity:!nomeSala.trim()?0.5:1}}>
                          {criandoSala?"Criando...":"Criar"}
                        </button>
                        <button onClick={()=>setNovaSala(false)} style={{flex:1,padding:"8px",borderRadius:8,border:"none",background:"rgba(255,255,255,0.1)",color:"rgba(255,255,255,0.6)",fontSize:13,cursor:"pointer"}}>Cancelar</button>
                      </div>
                    </div>
                  )}
                  {salas.map(s=>(
                    <button key={s.id} onClick={()=>entrarSala(s)} style={{width:"100%",display:"flex",alignItems:"center",gap:10,padding:"10px 10px",borderRadius:10,border:"none",cursor:"pointer",textAlign:"left",background:salaAtiva?.id===s.id?"rgba(99,102,241,0.2)":"transparent",transition:"background .15s"}}>
                      <div style={{width:8,height:8,borderRadius:"50%",background:salaAtiva?.id===s.id?"#6366f1":"rgba(255,255,255,0.2)",flexShrink:0}}/>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{color:salaAtiva?.id===s.id?"#a5b4fc":"rgba(255,255,255,0.8)",fontWeight:salaAtiva?.id===s.id?700:400,fontSize:14,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}># {s.nome}</div>
                        {s.agentes_ativos?.length>0 && <div style={{fontSize:11,color:"rgba(99,102,241,0.6)"}}>{s.agentes_ativos.map(n=>agentes.find(a=>a.nome===n)?.avatar_emoji||"🤖").join("")} {s.agentes_ativos.join(", ")}</div>}
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {/* ABA: PESSOAS */}
              {aba==="pessoas" && (
                <div>
                  <div style={{padding:"6px 6px 8px",fontSize:11,color:"rgba(255,255,255,0.35)",fontWeight:600,letterSpacing:1}}>{onlineCount} ONLINE</div>
                  {outrosUsuarios.sort((a,b)=>b.online-a.online).map(u=>(
                    <button key={u.id} onClick={()=>abrirDM(u)} style={{width:"100%",display:"flex",alignItems:"center",gap:10,padding:"9px 8px",borderRadius:10,border:"none",cursor:"pointer",textAlign:"left",background:dmAlvo?.id===u.id?"rgba(99,102,241,0.2)":"transparent"}}>
                      <div style={{position:"relative",flexShrink:0}}>
                        <Avatar nome={u.nome} size={32} cor={hashCor(u.nome)} />
                        <div style={{position:"absolute",bottom:0,right:0,width:9,height:9,borderRadius:"50%",background:u.online?"#22c55e":"#6b7280",border:"2px solid #0f0e1a"}}/>
                      </div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{color:"rgba(255,255,255,0.85)",fontSize:13,fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{u.nome}</div>
                        <div style={{fontSize:11,color:u.online?"#22c55e":"rgba(255,255,255,0.3)"}}>{u.online?"online":"offline"}</div>
                      </div>
                    </button>
                  ))}
                  {outrosUsuarios.length===0 && <div style={{textAlign:"center",color:"rgba(255,255,255,0.2)",fontSize:13,padding:20}}>Nenhum outro usuário ainda</div>}
                </div>
              )}

              {/* ABA: AGENTES */}
              {aba==="agentes" && (
                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  <div style={{padding:"6px 6px 4px",fontSize:11,color:"rgba(255,255,255,0.35)",fontWeight:600,letterSpacing:1}}>AGENTES DE IA</div>
                  {agentes.map(ag=>(
                    <div key={ag.id} style={{background:"rgba(99,102,241,0.1)",border:"1px solid rgba(99,102,241,0.2)",borderRadius:12,padding:"12px"}}>
                      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                        <Avatar nome={ag.nome} emoji={ag.avatar_emoji} size={34} cor={ag.cor} />
                        <div>
                          <div style={{color:"#a5b4fc",fontWeight:700,fontSize:14}}>{ag.nome}</div>
                          <div style={{fontSize:11,color:"rgba(99,102,241,0.6)"}}>{ag.trigger}</div>
                        </div>
                      </div>
                      <div style={{color:"rgba(255,255,255,0.5)",fontSize:12,lineHeight:1.5}}>{ag.personalidade}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer do usuário */}
            <div style={{padding:"12px 12px",borderTop:"1px solid rgba(255,255,255,0.07)",display:"flex",alignItems:"center",gap:10}}>
              <div style={{position:"relative"}}>
                <Avatar nome={usuario.nome} size={34} cor="#6366f1" />
                <div style={{position:"absolute",bottom:0,right:0,width:9,height:9,borderRadius:"50%",background:"#22c55e",border:"2px solid #0f0e1a"}}/>
              </div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{color:"#fff",fontWeight:600,fontSize:13,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{usuario.nome}</div>
                <div style={{fontSize:11,color:"rgba(255,255,255,0.35)"}}>{usuario.papel}</div>
              </div>
              <button onClick={logout} title="Sair" style={{background:"none",border:"none",color:"rgba(255,255,255,0.3)",cursor:"pointer",fontSize:16}}>⏻</button>
            </div>
          </>
        )}

        {/* Sidebar colapsada: ícones */}
        {!sidebarAberta && (
          <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",padding:"10px 0",gap:8}}>
            {salas.slice(0,8).map(s=>(
              <button key={s.id} onClick={()=>{entrarSala(s);setSidebarAberta(true);}} title={s.nome} style={{width:40,height:40,borderRadius:10,border:"none",cursor:"pointer",background:salaAtiva?.id===s.id?"rgba(99,102,241,0.3)":"transparent",color:salaAtiva?.id===s.id?"#a5b4fc":"rgba(255,255,255,0.3)",fontSize:16}}>
                #
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Área de Chat */}
      <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
        {(salaAtiva||dmAlvo) ? (
          <ChatArea sala={salaAtiva} usuario={usuario} usuarios={usuarios} agentes={agentes} dmAlvo={dmAlvo} onVoltar={null} />
        ) : (
          <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",color:"rgba(255,255,255,0.2)",gap:16}}>
            <div style={{fontSize:64}}>💬</div>
            <div style={{fontSize:20,fontWeight:700,color:"rgba(255,255,255,0.4)"}}>Bem-vindo ao MeetSpace!</div>
            <div style={{fontSize:14,textAlign:"center",maxWidth:400,lineHeight:1.7}}>
              Selecione uma sala no painel esquerdo para começar a conversar.<br/>
              Mencione <span style={{color:"#a5b4fc"}}>@Nexus</span>, <span style={{color:"#10b981"}}>@Ata</span> ou <span style={{color:"#f59e0b"}}>@Ideia</span> para interagir com os agentes de IA.
            </div>
            <div style={{display:"flex",gap:12,marginTop:8}}>
              {salas.slice(0,3).map(s=>(
                <button key={s.id} onClick={()=>entrarSala(s)} style={{padding:"10px 20px",borderRadius:12,border:"1px solid rgba(99,102,241,0.3)",background:"rgba(99,102,241,0.1)",color:"#a5b4fc",cursor:"pointer",fontSize:14,fontWeight:600}}>
                  # {s.nome}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
