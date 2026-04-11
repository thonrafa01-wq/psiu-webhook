import { useState, useEffect } from "react";
import { Atendimento, ClienteWhatsapp } from "@/api/entities";

const SENHA_CORRETA = "7zvn87C2@";
const WEBHOOK_URL = "https://psiu-webhook.onrender.com";

const MOTIVO_LABEL = {
  boleto: "💰 Boleto/PIX",
  suporte: "🔧 Suporte Técnico",
  cancelamento: "❌ Cancelamento",
  menu: "📋 Menu",
  outro: "💬 Outro",
};

const MOTIVO_COLOR = {
  boleto: "bg-yellow-100 text-yellow-800",
  suporte: "bg-red-100 text-red-800",
  cancelamento: "bg-purple-100 text-purple-800",
  menu: "bg-blue-100 text-blue-800",
  outro: "bg-gray-100 text-gray-700",
};

const ESTADO_COLOR = {
  resolvido_auto: "bg-green-100 text-green-800",
  resolvido: "bg-green-100 text-green-800",
  transferido_humano: "bg-orange-100 text-orange-800",
  encaminhado_atendente: "bg-orange-100 text-orange-800",
  em_andamento: "bg-blue-100 text-blue-800",
  chamado_aberto: "bg-red-100 text-red-800",
  massiva: "bg-purple-100 text-purple-800",
  manutencao: "bg-yellow-100 text-yellow-800",
  audio_nao_transcrito: "bg-gray-100 text-gray-600",
};

const ESTADO_LABEL = {
  resolvido_auto: "✅ Resolvido",
  resolvido: "✅ Resolvido",
  transferido_humano: "👨‍💻 Atendente",
  encaminhado_atendente: "👨‍💻 Atendente",
  em_andamento: "⏳ Em andamento",
  chamado_aberto: "🔧 Chamado Aberto",
  massiva: "⚠️ Massiva",
  manutencao: "🛠️ Manutenção",
  audio_nao_transcrito: "🎤 Áudio não lido",
};

// Estados que significam "em atendimento humano"
const ESTADOS_HUMANO = ["atendente", "atendente_novo_cliente", "aguardando_humano"];

function LoginScreen({ onLogin }) {
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState(false);
  const [mostrar, setMostrar] = useState(false);

  function tentar(e) {
    e.preventDefault();
    if (senha === SENHA_CORRETA) {
      sessionStorage.setItem("psiu_auth", "1");
      onLogin();
    } else {
      setErro(true);
      setSenha("");
      setTimeout(() => setErro(false), 2000);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-sm">
        <div className="text-center mb-6">
          <span className="text-4xl">📡</span>
          <h1 className="text-xl font-bold text-gray-800 mt-2">PSIU TELECOM</h1>
          <p className="text-gray-500 text-sm mt-1">Central de Atendimento</p>
        </div>
        <form onSubmit={tentar} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Senha de acesso</label>
            <div className="relative">
              <input
                type={mostrar ? "text" : "password"}
                value={senha}
                onChange={e => setSenha(e.target.value)}
                className={`w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 ${
                  erro ? "border-red-400 ring-red-200" : "border-gray-300 focus:ring-green-200 focus:border-green-400"
                }`}
                placeholder="Digite a senha..."
                autoFocus
              />
              <button type="button" onClick={() => setMostrar(!mostrar)} className="absolute right-3 top-2 text-gray-400 text-sm">
                {mostrar ? "🙈" : "👁️"}
              </button>
            </div>
            {erro && <p className="text-red-500 text-xs mt-1">Senha incorreta. Tente novamente.</p>}
          </div>
          <button type="submit" className="w-full bg-green-600 hover:bg-green-700 text-white font-medium py-2 rounded-lg transition-colors">
            Entrar
          </button>
        </form>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [autenticado, setAutenticado] = useState(() => sessionStorage.getItem("psiu_auth") === "1");
  const [atendimentos, setAtendimentos] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [recarregando, setRecarregando] = useState(false);
  const [abaAtiva, setAbaAtiva] = useState("ativos");
  const [filtroMotivo, setFiltroMotivo] = useState("todos");
  const [salvandoId, setSalvandoId] = useState(null);
  const [fechandoTodos, setFechandoTodos] = useState(false);
  const [toastMsg, setToastMsg] = useState(null);

  useEffect(() => {
    if (!autenticado) return;
    carregarDados();
    const interval = setInterval(carregarDados, 20000);
    return () => clearInterval(interval);
  }, [autenticado]);

  function toast(msg, tipo = "success") {
    setToastMsg({ msg, tipo });
    setTimeout(() => setToastMsg(null), 3000);
  }

  async function carregarDados() {
    setRecarregando(true);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000); // 20s timeout
      let res;
      try {
        res = await fetch(`${WEBHOOK_URL}/dashboard-data`, { signal: controller.signal, headers: { 'x-service-key': 'vMUGDUNk_08X3aIZKDyHrFLDGEnLza8pfe53Pvv3tkU' } });
        clearTimeout(timeout);
      } catch(fetchErr) {
        clearTimeout(timeout);
        console.warn('[Dashboard] Render indisponível:', fetchErr.message);
        res = null;
      }
      if (res && res.ok) {
        const data = await res.json();
        setAtendimentos(data.atendimentos || []);
        setClientes(data.clientes || []);
      } else {
        // fallback: SDK direto
        const [ats, cls] = await Promise.all([
          Atendimento.list({ sort: "-data_atendimento", limit: 500 }),
          ClienteWhatsapp.list({ limit: 500 }),
        ]);
        setAtendimentos(ats || []);
        setClientes(cls || []);
      }
    } catch(e) {
      console.error('[Dashboard] Erro ao carregar:', e.message);
    } finally {
      setLoading(false);
      setRecarregando(false);
    }
  }

  if (!autenticado) return <LoginScreen onLogin={() => setAutenticado(true)} />;

  // ── Dados computados ────────────────────────────────────────────────────────
  const hoje = new Date().toISOString().slice(0, 10);
  const atHoje = atendimentos.filter(a => a.data_atendimento?.slice(0, 10) === hoje);
  const emAtendimentoHumano = clientes.filter(c => ESTADOS_HUMANO.includes(c.estado_conversa));
  const resolvidosAuto = atendimentos.filter(a => a.estado_final === "resolvido_auto" || a.estado_final === "resolvido").length;
  const totalAtendimentos = atendimentos.length;
  const taxaResolucao = totalAtendimentos > 0 ? Math.round((resolvidosAuto / totalAtendimentos) * 100) : 0;

  const motivoCount = atendimentos.reduce((acc, a) => {
    acc[a.motivo] = (acc[a.motivo] || 0) + 1;
    return acc;
  }, {});
  const motivosOrdenados = Object.entries(motivoCount).sort((a, b) => b[1] - a[1]);

  const atsFiltrados = filtroMotivo === "todos" ? atendimentos : atendimentos.filter(a => a.motivo === filtroMotivo);

  // ── Ações ───────────────────────────────────────────────────────────────────

  // Encerrar atendimento humano de 1 cliente — bot volta a atender + mensagem de encerramento
  async function encerrarAtendimento(cliente) {
    setSalvandoId(cliente.id);
    try {
      await ClienteWhatsapp.update(cliente.id, { estado_conversa: "identificado" });
      // Avisar o cliente via webhook
      const tel = cliente.telefone;
      await fetch(`${WEBHOOK_URL}/encerrar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telefone: tel })
      }).catch(() => {}); // Se falhar não trava
      await carregarDados();
      toast(`✅ Atendimento de ${cliente.nome || cliente.telefone} encerrado`);
    } catch (e) {
      toast("❌ Erro ao encerrar atendimento", "error");
    } finally {
      setSalvandoId(null);
    }
  }

  // Encerrar todos os atendimentos humanos de uma vez
  async function encerrarTodos() {
    if (emAtendimentoHumano.length === 0) return;
    setFechandoTodos(true);
    try {
      for (const c of emAtendimentoHumano) {
        await ClienteWhatsapp.update(c.id, { estado_conversa: "identificado" });
        await fetch(`${WEBHOOK_URL}/encerrar`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ telefone: c.telefone })
        }).catch(() => {});
      }
      await carregarDados();
      toast(`✅ ${emAtendimentoHumano.length} atendimento(s) encerrado(s)`);
    } catch (e) {
      toast("❌ Erro ao encerrar atendimentos", "error");
    } finally {
      setFechandoTodos(false);
    }
  }

  // Assumir manualmente (pausa o bot sem enviar mensagem)
  async function assumirAtendimento(cliente) {
    setSalvandoId(cliente.id);
    try {
      await ClienteWhatsapp.update(cliente.id, { estado_conversa: "atendente" });
      await carregarDados();
      toast(`👨‍💻 Assumido atendimento de ${cliente.nome || cliente.telefone}`);
    } finally {
      setSalvandoId(null);
    }
  }

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin w-10 h-10 border-4 border-green-500 border-t-transparent rounded-full mx-auto mb-3"></div>
        <p className="text-gray-500">Carregando dados...</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 pb-10">

      {/* Toast */}
      {toastMsg && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-xl shadow-lg text-white text-sm font-medium transition-all ${
          toastMsg.tipo === "error" ? "bg-red-600" : "bg-green-600"
        }`}>
          {toastMsg.msg}
        </div>
      )}

      {/* Header */}
      <div className="bg-green-600 text-white px-4 py-4 shadow sticky top-0 z-40">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">📡</span>
            <div>
              <h1 className="text-lg font-bold leading-tight">PSIU TELECOM</h1>
              <p className="text-green-200 text-xs">Central de Atendimento</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {emAtendimentoHumano.length > 0 && (
              <span className="bg-orange-500 text-white text-xs font-bold px-2 py-1 rounded-full animate-pulse">
                {emAtendimentoHumano.length} humano
              </span>
            )}
            <button onClick={carregarDados} disabled={recarregando} className={`${recarregando ? 'bg-green-300 cursor-wait' : 'bg-green-500 hover:bg-green-400'} p-2 rounded-lg text-sm transition-colors`}>
              {recarregando ? '⏳' : '🔄'}
            </button>
            <button onClick={() => { sessionStorage.removeItem("psiu_auth"); setAutenticado(false); }} className="bg-green-700 hover:bg-green-600 p-2 rounded-lg text-sm">🚪</button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="max-w-5xl mx-auto px-4 mt-4">
        <div className="flex gap-1 bg-white rounded-xl p-1 shadow-sm overflow-x-auto">
          {[
            { id: "ativos", label: "👨‍💻 Em Atendimento" },
            { id: "dashboard", label: "📊 Dashboard" },
            { id: "historico", label: "📋 Histórico" },
            { id: "clientes", label: "👥 Clientes" },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setAbaAtiva(tab.id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors flex-shrink-0 ${
                abaAtiva === tab.id ? "bg-green-600 text-white" : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              {tab.label}
              {tab.id === "ativos" && emAtendimentoHumano.length > 0 && (
                <span className="ml-1.5 bg-orange-500 text-white text-xs px-1.5 py-0.5 rounded-full">
                  {emAtendimentoHumano.length}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-4">

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* ABA: EM ATENDIMENTO HUMANO                                        */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        {abaAtiva === "ativos" && (
          <div className="space-y-4">

            {/* Banner quando não tem ninguém */}
            {emAtendimentoHumano.length === 0 ? (
              <div className="bg-white rounded-2xl shadow-sm p-10 text-center">
                <div className="text-5xl mb-3">🤖</div>
                <h2 className="text-lg font-semibold text-gray-700">Bot no controle!</h2>
                <p className="text-gray-400 text-sm mt-1">Nenhum cliente em atendimento humano agora.</p>
              </div>
            ) : (
              <>
                {/* Botão "Encerrar todos" */}
                <div className="flex items-center justify-between">
                  <p className="text-sm text-gray-600 font-medium">
                    {emAtendimentoHumano.length} cliente(s) aguardando — bot pausado para eles
                  </p>
                  <button
                    onClick={encerrarTodos}
                    disabled={fechandoTodos}
                    className="bg-green-600 hover:bg-green-700 text-white text-sm px-4 py-2 rounded-lg font-medium disabled:opacity-50 flex items-center gap-2"
                  >
                    {fechandoTodos ? (
                      <><span className="animate-spin">⏳</span> Encerrando...</>
                    ) : (
                      <>🤖 Devolver todos ao bot</>
                    )}
                  </button>
                </div>

                {/* Cards dos clientes em atendimento */}
                <div className="grid gap-3">
                  {emAtendimentoHumano
                    .sort((a, b) => new Date(b.ultimo_contato || 0) - new Date(a.ultimo_contato || 0))
                    .map(c => {
                      const tempoEspera = c.ultimo_contato
                        ? Math.round((Date.now() - new Date(c.ultimo_contato)) / 60000)
                        : null;
                      return (
                        <div key={c.id} className="bg-white rounded-2xl shadow-sm border-l-4 border-orange-400 p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-semibold text-gray-800">{c.nome || "Sem nome"}</span>
                                <span className={`text-xs px-2 py-0.5 rounded-full ${
                                  c.estado_conversa === "atendente_novo_cliente"
                                    ? "bg-blue-100 text-blue-700"
                                    : "bg-orange-100 text-orange-700"
                                }`}>
                                  {c.estado_conversa === "atendente_novo_cliente" ? "🆕 Novo Cliente" : "👨‍💻 Atendimento"}
                                </span>
                              </div>
                              <p className="text-sm text-gray-500 mt-0.5">📞 {c.telefone.replace(/^55/, '')}</p>
                              {tempoEspera !== null && (
                                <p className={`text-xs mt-1 ${tempoEspera > 30 ? "text-red-500 font-medium" : "text-gray-400"}`}>
                                  ⏱️ {tempoEspera < 1 ? "agora mesmo" : `há ${tempoEspera} min`}
                                  {tempoEspera > 30 && " — aguardando há muito tempo!"}
                                </p>
                              )}
                            </div>
                            <button
                              onClick={() => encerrarAtendimento(c)}
                              disabled={salvandoId === c.id}
                              className="bg-green-600 hover:bg-green-700 text-white text-sm px-4 py-2 rounded-xl font-medium disabled:opacity-50 whitespace-nowrap flex-shrink-0"
                            >
                              {salvandoId === c.id ? "⏳" : "✅ Encerrar"}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </>
            )}

            {/* Seção: assumir atendimento manualmente */}
            <div className="bg-white rounded-2xl shadow-sm mt-6">
              <div className="p-4 border-b">
                <h3 className="font-semibold text-gray-700">🤖 Clientes no bot</h3>
                <p className="text-xs text-gray-400 mt-0.5">Toque em "Assumir" para pausar o bot e atender manualmente</p>
              </div>
              <div className="divide-y max-h-80 overflow-y-auto">
                {clientes.filter(c => !ESTADOS_HUMANO.includes(c.estado_conversa) && c.identificado && c.ultimo_contato && (new Date() - new Date(c.ultimo_contato)) < 2 * 60 * 60 * 1000).length === 0 ? (
                  <p className="p-4 text-gray-400 text-sm">Nenhum cliente ativo no bot</p>
                ) : clientes
                  .filter(c => !ESTADOS_HUMANO.includes(c.estado_conversa) && c.identificado && c.ultimo_contato && (new Date() - new Date(c.ultimo_contato)) < 2 * 60 * 60 * 1000)
                  .sort((a, b) => new Date(b.ultimo_contato || 0) - new Date(a.ultimo_contato || 0))
                  .map(c => (
                    <div key={c.id} className="p-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-sm text-gray-800 truncate">{c.nome || "Sem nome"}</p>
                        <p className="text-xs text-gray-400">{c.telefone.replace(/^55/, '')}</p>
                      </div>
                      <button
                        onClick={() => assumirAtendimento(c)}
                        disabled={salvandoId === c.id}
                        className="bg-orange-500 hover:bg-orange-600 text-white text-xs px-3 py-1.5 rounded-lg disabled:opacity-50 whitespace-nowrap flex-shrink-0"
                      >
                        {salvandoId === c.id ? "⏳" : "👨‍💻 Assumir"}
                      </button>
                    </div>
                  ))}
              </div>
            </div>
          {/* Seção: Finalizados */}
            <div className="bg-white rounded-2xl shadow-sm mt-6">
              <div className="p-4 border-b flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-gray-700">✅ Finalizados hoje</h3>
                  <p className="text-xs text-gray-400 mt-0.5">Atendimentos encerrados pelo bot ou pelo atendente</p>
                </div>
                <span className="bg-green-100 text-green-700 text-xs font-bold px-2 py-1 rounded-full">
                  {atHoje.filter(a => ["resolvido", "resolvido_auto", "comprovante_enviado", "sem_debitos"].includes(a.estado_final)).length}
                </span>
              </div>
              <div className="divide-y max-h-80 overflow-y-auto">
                {atHoje.filter(a => ["resolvido", "resolvido_auto", "comprovante_enviado", "sem_debitos"].includes(a.estado_final)).length === 0 ? (
                  <p className="p-4 text-gray-400 text-sm">Nenhum atendimento finalizado hoje ainda</p>
                ) : atHoje
                  .filter(a => ["resolvido", "resolvido_auto", "comprovante_enviado", "sem_debitos"].includes(a.estado_final))
                  .sort((a, b) => new Date(b.data_atendimento || 0) - new Date(a.data_atendimento || 0))
                  .map(a => {
                    const hora = a.data_atendimento ? new Date(a.data_atendimento).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '--:--';
                    const iconeMotivo = { suporte: '🔧', boleto: '💰', cancelamento: '❌', comprovante_enviado: '🧾', sem_debitos: '✅', pagamento: '💳' }[a.motivo] || '📋';
                    const labelEstado = { resolvido: 'Resolvido', resolvido_auto: 'Bot', comprovante_enviado: 'Comprovante', sem_debitos: 'Sem débitos' }[a.estado_final] || a.estado_final;
                    return (
                      <div key={a.id} className="p-3 flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-sm text-gray-800 truncate">{iconeMotivo} {a.nome_cliente || "Sem nome"}</p>
                          <p className="text-xs text-gray-400">{a.telefone?.replace(/^55/, '')} · {hora}</p>
                        </div>
                        <span className="bg-green-100 text-green-700 text-xs px-2 py-0.5 rounded-full whitespace-nowrap flex-shrink-0">{labelEstado}</span>
                      </div>
                    );
                  })}
              </div>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* ABA: DASHBOARD                                                    */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        {abaAtiva === "dashboard" && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard icon="📨" label="Hoje" value={atHoje.length} color="blue" />
              <StatCard icon="📦" label="Total" value={totalAtendimentos} color="gray" />
              <StatCard icon="✅" label="Resolvidos pelo Bot" value={`${taxaResolucao}%`} color="green" />
              <StatCard icon="👨‍💻" label="Em Atendimento" value={emAtendimentoHumano.length} color={emAtendimentoHumano.length > 0 ? "orange" : "green"} />
            </div>

            <div className="bg-white rounded-xl shadow-sm p-5">
              <h2 className="font-semibold text-gray-700 mb-4">🎯 Motivos mais frequentes</h2>
              {motivosOrdenados.length === 0 ? (
                <p className="text-gray-400 text-sm">Nenhum atendimento ainda</p>
              ) : (
                <div className="space-y-3">
                  {motivosOrdenados.map(([motivo, count]) => {
                    const pct = Math.round((count / totalAtendimentos) * 100);
                    return (
                      <div key={motivo}>
                        <div className="flex justify-between text-sm mb-1">
                          <span>{MOTIVO_LABEL[motivo] || motivo}</span>
                          <span className="text-gray-500">{count} ({pct}%)</span>
                        </div>
                        <div className="bg-gray-100 rounded-full h-2">
                          <div className="bg-green-500 h-2 rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Alertas do dia */}
            {atHoje.filter(a => a.motivo === "suporte" || a.motivo === "cancelamento").length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                <h3 className="font-semibold text-red-700 mb-2">⚠️ Atenção hoje</h3>
                <div className="space-y-1">
                  {atHoje.filter(a => a.motivo === "cancelamento").length > 0 && (
                    <p className="text-sm text-red-600">❌ {atHoje.filter(a => a.motivo === "cancelamento").length} pedido(s) de cancelamento</p>
                  )}
                  {atHoje.filter(a => a.estado_final === "massiva").length > 0 && (
                    <p className="text-sm text-red-600">🚨 Ocorrência de massiva detectada</p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* ABA: HISTÓRICO                                                    */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        {abaAtiva === "historico" && (
          <div className="space-y-3">
            <div className="flex gap-2 flex-wrap">
              {["todos", "boleto", "suporte", "cancelamento", "outro"].map(m => (
                <button
                  key={m}
                  onClick={() => setFiltroMotivo(m)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    filtroMotivo === m ? "bg-green-600 text-white" : "bg-white text-gray-600 shadow-sm hover:bg-gray-50"
                  }`}
                >
                  {m === "todos" ? "Todos" : MOTIVO_LABEL[m]}
                </button>
              ))}
            </div>

            <div className="bg-white rounded-xl shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-600">
                    <tr>
                      <th className="text-left px-4 py-3">Cliente</th>
                      <th className="text-left px-4 py-3">Motivo</th>
                      <th className="text-left px-4 py-3">Status</th>
                      <th className="text-left px-4 py-3">Data</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {atsFiltrados.slice(0, 100).map(a => (
                      <tr key={a.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <p className="font-medium">{a.nome_cliente || "—"}</p>
                          <p className="text-xs text-gray-400">{a.telefone}</p>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-1 rounded-full ${MOTIVO_COLOR[a.motivo] || "bg-gray-100 text-gray-600"}`}>
                            {MOTIVO_LABEL[a.motivo] || a.motivo}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-1 rounded-full ${ESTADO_COLOR[a.estado_final] || "bg-gray-100 text-gray-600"}`}>
                            {ESTADO_LABEL[a.estado_final] || a.estado_final}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500">
                          {a.data_atendimento ? new Date(a.data_atendimento).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {atsFiltrados.length === 0 && (
                  <p className="text-center text-gray-400 py-8 text-sm">Nenhum atendimento encontrado</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* ABA: CLIENTES                                                     */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        {abaAtiva === "clientes" && (
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="text-left px-4 py-3">Cliente</th>
                    <th className="text-left px-4 py-3">Status</th>
                    <th className="text-left px-4 py-3">Último contato</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {clientes
                    .sort((a, b) => new Date(b.ultimo_contato || 0) - new Date(a.ultimo_contato || 0))
                    .map(c => (
                      <tr key={c.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <p className="font-medium">{c.nome || "Sem nome"}</p>
                          <p className="text-xs text-gray-400">{c.telefone.replace(/^55/, "")}</p>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-1 rounded-full ${
                            ESTADOS_HUMANO.includes(c.estado_conversa)
                              ? "bg-orange-100 text-orange-700"
                              : c.identificado
                              ? "bg-green-100 text-green-700"
                              : "bg-gray-100 text-gray-500"
                          }`}>
                            {ESTADOS_HUMANO.includes(c.estado_conversa) ? "👨‍💻 Humano" : c.identificado ? "🤖 Bot" : "❓ Novo"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500">
                          {c.ultimo_contato ? new Date(c.ultimo_contato).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
              {clientes.length === 0 && (
                <p className="text-center text-gray-400 py-8 text-sm">Nenhum cliente ainda</p>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

function StatCard({ icon, label, value, color }) {
  const colors = {
    blue: "bg-blue-50 text-blue-700",
    green: "bg-green-50 text-green-700",
    orange: "bg-orange-50 text-orange-700",
    gray: "bg-gray-50 text-gray-700",
  };
  return (
    <div className={`rounded-xl p-4 shadow-sm ${colors[color]}`}>
      <div className="text-2xl mb-1">{icon}</div>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs opacity-75">{label}</div>
    </div>
  );
}
