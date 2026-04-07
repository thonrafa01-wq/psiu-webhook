import { useState, useEffect } from "react";
import { Atendimento, ClienteWhatsapp } from "@/api/entities";

const SENHA_CORRETA = "7zvn87C2@";

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
  transferido_humano: "bg-orange-100 text-orange-800",
  em_andamento: "bg-blue-100 text-blue-800",
};

const ESTADO_LABEL = {
  resolvido_auto: "✅ Resolvido",
  transferido_humano: "👨‍💻 Humano",
  em_andamento: "⏳ Em andamento",
};

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
              <button
                type="button"
                onClick={() => setMostrar(!mostrar)}
                className="absolute right-3 top-2 text-gray-400 text-sm"
              >
                {mostrar ? "🙈" : "👁️"}
              </button>
            </div>
            {erro && <p className="text-red-500 text-xs mt-1">Senha incorreta. Tente novamente.</p>}
          </div>
          <button
            type="submit"
            className="w-full bg-green-600 hover:bg-green-700 text-white font-medium py-2 rounded-lg transition-colors"
          >
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
  const [abaAtiva, setAbaAtiva] = useState("dashboard");
  const [filtroMotivo, setFiltroMotivo] = useState("todos");
  const [salvandoId, setSalvandoId] = useState(null);

  useEffect(() => {
    if (!autenticado) return;
    carregarDados();
    const interval = setInterval(carregarDados, 30000);
    return () => clearInterval(interval);
  }, [autenticado]);

  async function carregarDados() {
    try {
      const [ats, cls] = await Promise.all([
        Atendimento.list({ sort: "-data_atendimento", limit: 500 }),
        ClienteWhatsapp.list({ limit: 500 }),
      ]);
      setAtendimentos(ats);
      setClientes(cls);
    } finally {
      setLoading(false);
    }
  }

  if (!autenticado) return <LoginScreen onLogin={() => setAutenticado(true)} />;

  const hoje = new Date().toISOString().slice(0, 10);
  const atHoje = atendimentos.filter(a => a.data_atendimento?.slice(0, 10) === hoje);
  const emAtendimentoHumano = clientes.filter(c => c.estado_conversa === "aguardando_humano");
  const resolvidosAuto = atendimentos.filter(a => a.estado_final === "resolvido_auto").length;
  const totalAtendimentos = atendimentos.length;
  const taxaResolucao = totalAtendimentos > 0 ? Math.round((resolvidosAuto / totalAtendimentos) * 100) : 0;

  const motivoCount = atendimentos.reduce((acc, a) => {
    acc[a.motivo] = (acc[a.motivo] || 0) + 1;
    return acc;
  }, {});
  const motivosOrdenados = Object.entries(motivoCount).sort((a, b) => b[1] - a[1]);

  const clienteCount = atendimentos.reduce((acc, a) => {
    if (!a.nome_cliente) return acc;
    if (!acc[a.telefone]) acc[a.telefone] = { nome: a.nome_cliente, telefone: a.telefone, count: 0, motivos: {} };
    acc[a.telefone].count++;
    acc[a.telefone].motivos[a.motivo] = (acc[a.telefone].motivos[a.motivo] || 0) + 1;
    return acc;
  }, {});
  const clientesRecorrentes = Object.values(clienteCount).sort((a, b) => b.count - a.count).slice(0, 10);

  const atsFiltrados = filtroMotivo === "todos" ? atendimentos : atendimentos.filter(a => a.motivo === filtroMotivo);

  async function assumirAtendimento(cliente) {
    setSalvandoId(cliente.id);
    try {
      await ClienteWhatsapp.update(cliente.id, { estado_conversa: "aguardando_humano" });
      await carregarDados();
    } finally {
      setSalvandoId(null);
    }
  }

  async function liberarAtendimento(cliente) {
    setSalvandoId(cliente.id);
    try {
      await ClienteWhatsapp.update(cliente.id, { estado_conversa: "identificado" });
      await carregarDados();
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
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-green-600 text-white px-6 py-4 shadow">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">📡</span>
            <div>
              <h1 className="text-xl font-bold">PSIU TELECOM</h1>
              <p className="text-green-200 text-sm">Central de Atendimento WhatsApp</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={carregarDados} className="bg-green-500 hover:bg-green-400 px-3 py-1.5 rounded text-sm flex items-center gap-2">
              🔄 Atualizar
            </button>
            <button
              onClick={() => { sessionStorage.removeItem("psiu_auth"); setAutenticado(false); }}
              className="bg-green-700 hover:bg-green-600 px-3 py-1.5 rounded text-sm"
            >
              Sair
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="max-w-7xl mx-auto px-4 mt-4">
        <div className="flex gap-1 bg-white rounded-lg p-1 shadow-sm w-fit flex-wrap">
          {[
            { id: "dashboard", label: "📊 Dashboard" },
            { id: "historico", label: "📋 Histórico" },
            { id: "clientes", label: "👥 Clientes" },
            { id: "controle", label: "🎛️ Controle Manual" },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setAbaAtiva(tab.id)}
              className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
                abaAtiva === tab.id ? "bg-green-600 text-white" : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-4">

        {/* Dashboard */}
        {abaAtiva === "dashboard" && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard icon="📨" label="Hoje" value={atHoje.length} color="blue" />
              <StatCard icon="📦" label="Total Atendimentos" value={totalAtendimentos} color="gray" />
              <StatCard icon="✅" label="Taxa de Resolução" value={`${taxaResolucao}%`} color="green" />
              <StatCard icon="👨‍💻" label="Aguardando Humano" value={emAtendimentoHumano.length} color={emAtendimentoHumano.length > 0 ? "orange" : "green"} />
            </div>

            <div className="grid md:grid-cols-2 gap-4">
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
                            <span className="font-medium">{MOTIVO_LABEL[motivo] || motivo}</span>
                            <span className="text-gray-500">{count} ({pct}%)</span>
                          </div>
                          <div className="bg-gray-100 rounded-full h-2">
                            <div className="bg-green-500 h-2 rounded-full transition-all" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="bg-white rounded-xl shadow-sm p-5">
                <h2 className="font-semibold text-gray-700 mb-4">🔁 Clientes que mais contatam</h2>
                {clientesRecorrentes.length === 0 ? (
                  <p className="text-gray-400 text-sm">Nenhum dado ainda</p>
                ) : (
                  <div className="space-y-2">
                    {clientesRecorrentes.map((c, i) => (
                      <div key={c.telefone} className="flex items-center justify-between py-2 border-b last:border-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-400 w-4">{i + 1}.</span>
                          <div>
                            <p className="text-sm font-medium text-gray-800">{c.nome || c.telefone}</p>
                            <p className="text-xs text-gray-400">{c.telefone}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <span className="bg-green-100 text-green-800 text-xs font-semibold px-2 py-1 rounded-full">{c.count}x</span>
                          <div className="flex gap-1 mt-1 justify-end flex-wrap">
                            {Object.entries(c.motivos).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([m]) => (
                              <span key={m} className={`text-xs px-1.5 py-0.5 rounded ${MOTIVO_COLOR[m]}`}>
                                {MOTIVO_LABEL[m]?.split(" ")[0]}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {emAtendimentoHumano.length > 0 && (
              <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
                <h3 className="font-semibold text-orange-800 mb-2">⚠️ Aguardando atendimento humano ({emAtendimentoHumano.length})</h3>
                <div className="flex flex-wrap gap-2">
                  {emAtendimentoHumano.map(c => (
                    <div key={c.id} className="bg-white border border-orange-200 rounded-lg px-3 py-2 text-sm flex items-center gap-2">
                      <span className="font-medium">{c.nome || c.telefone}</span>
                      <button onClick={() => setAbaAtiva("controle")} className="text-orange-600 hover:underline text-xs">gerenciar →</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Histórico */}
        {abaAtiva === "historico" && (
          <div className="bg-white rounded-xl shadow-sm">
            <div className="p-4 border-b flex items-center gap-3 flex-wrap">
              <span className="font-semibold text-gray-700">Filtrar:</span>
              {["todos", "boleto", "suporte", "cancelamento", "menu", "outro"].map(m => (
                <button
                  key={m}
                  onClick={() => setFiltroMotivo(m)}
                  className={`px-3 py-1 rounded-full text-sm ${filtroMotivo === m ? "bg-green-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
                >
                  {m === "todos" ? "Todos" : MOTIVO_LABEL[m]}
                </button>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-gray-500 text-left">
                    <th className="px-4 py-3">Data/Hora</th>
                    <th className="px-4 py-3">Cliente</th>
                    <th className="px-4 py-3">Telefone</th>
                    <th className="px-4 py-3">Motivo</th>
                    <th className="px-4 py-3">Mensagem</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {atsFiltrados.slice(0, 100).map(a => (
                    <tr key={a.id} className="border-t hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                        {a.data_atendimento ? new Date(a.data_atendimento).toLocaleString("pt-BR") : "-"}
                      </td>
                      <td className="px-4 py-3 font-medium">{a.nome_cliente || "-"}</td>
                      <td className="px-4 py-3 text-gray-500">{a.telefone}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${MOTIVO_COLOR[a.motivo]}`}>
                          {MOTIVO_LABEL[a.motivo] || a.motivo}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 max-w-xs truncate">{a.mensagem_original}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${ESTADO_COLOR[a.estado_final]}`}>
                          {ESTADO_LABEL[a.estado_final] || a.estado_final}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {atsFiltrados.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Nenhum atendimento encontrado</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Clientes */}
        {abaAtiva === "clientes" && (
          <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
            <div className="p-4 border-b">
              <h2 className="font-semibold text-gray-700">👥 Todos os clientes ({clientes.length})</h2>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-gray-500 text-left">
                  <th className="px-4 py-3">Nome</th>
                  <th className="px-4 py-3">Telefone</th>
                  <th className="px-4 py-3">CPF/CNPJ</th>
                  <th className="px-4 py-3">Identificado</th>
                  <th className="px-4 py-3">Estado</th>
                  <th className="px-4 py-3">Último Contato</th>
                  <th className="px-4 py-3">Atendimentos</th>
                </tr>
              </thead>
              <tbody>
                {clientes.map(c => {
                  const totalC = atendimentos.filter(a => a.telefone === c.telefone).length;
                  return (
                    <tr key={c.id} className="border-t hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium">{c.nome || "-"}</td>
                      <td className="px-4 py-3 text-gray-500">{c.telefone}</td>
                      <td className="px-4 py-3 text-gray-500">{c.cpf_cnpj || "-"}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded-full text-xs ${c.identificado ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                          {c.identificado ? "✅ Sim" : "❓ Não"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                          c.estado_conversa === "aguardando_humano" ? "bg-orange-100 text-orange-700" :
                          c.estado_conversa === "identificado" ? "bg-green-100 text-green-700" :
                          "bg-blue-100 text-blue-700"
                        }`}>
                          {c.estado_conversa === "aguardando_humano" ? "👨‍💻 Humano" :
                           c.estado_conversa === "identificado" ? "🤖 Bot" :
                           c.estado_conversa || "-"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                        {c.ultimo_contato ? new Date(c.ultimo_contato).toLocaleString("pt-BR") : "-"}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="bg-gray-100 text-gray-700 text-xs font-semibold px-2 py-1 rounded-full">{totalC}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Controle Manual */}
        {abaAtiva === "controle" && (
          <div className="space-y-4">
            <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 text-sm text-yellow-800">
              <strong>⚡ Controle Manual:</strong> Assuma o atendimento de qualquer cliente (o bot para de responder) ou devolva ao bot quando quiser. Use quando o agente não estiver funcionando corretamente.
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div className="bg-white rounded-xl shadow-sm">
                <div className="p-4 border-b bg-orange-50 rounded-t-xl">
                  <h3 className="font-semibold text-orange-800">👨‍💻 Em atendimento humano ({emAtendimentoHumano.length})</h3>
                  <p className="text-xs text-orange-600 mt-1">Bot pausado para esses clientes</p>
                </div>
                <div className="divide-y">
                  {emAtendimentoHumano.length === 0 ? (
                    <p className="p-4 text-gray-400 text-sm">Nenhum cliente aguardando humano</p>
                  ) : emAtendimentoHumano.map(c => (
                    <div key={c.id} className="p-4 flex items-center justify-between">
                      <div>
                        <p className="font-medium text-sm">{c.nome || "Sem nome"}</p>
                        <p className="text-xs text-gray-400">{c.telefone}</p>
                        {c.ultimo_contato && (
                          <p className="text-xs text-gray-400">{new Date(c.ultimo_contato).toLocaleString("pt-BR")}</p>
                        )}
                      </div>
                      <button
                        onClick={() => liberarAtendimento(c)}
                        disabled={salvandoId === c.id}
                        className="bg-green-600 hover:bg-green-700 text-white text-xs px-3 py-2 rounded-lg disabled:opacity-50"
                      >
                        {salvandoId === c.id ? "..." : "🤖 Devolver ao Bot"}
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-white rounded-xl shadow-sm">
                <div className="p-4 border-b bg-blue-50 rounded-t-xl">
                  <h3 className="font-semibold text-blue-800">🤖 No bot automático</h3>
                  <p className="text-xs text-blue-600 mt-1">Clique para assumir manualmente</p>
                </div>
                <div className="divide-y max-h-96 overflow-y-auto">
                  {clientes.filter(c => c.estado_conversa !== "aguardando_humano" && c.identificado).length === 0 ? (
                    <p className="p-4 text-gray-400 text-sm">Nenhum cliente ativo no bot</p>
                  ) : clientes
                    .filter(c => c.estado_conversa !== "aguardando_humano" && c.identificado)
                    .sort((a, b) => new Date(b.ultimo_contato || 0) - new Date(a.ultimo_contato || 0))
                    .map(c => (
                      <div key={c.id} className="p-4 flex items-center justify-between">
                        <div>
                          <p className="font-medium text-sm">{c.nome || "Sem nome"}</p>
                          <p className="text-xs text-gray-400">{c.telefone}</p>
                          {c.ultimo_contato && (
                            <p className="text-xs text-gray-400">{new Date(c.ultimo_contato).toLocaleString("pt-BR")}</p>
                          )}
                        </div>
                        <button
                          onClick={() => assumirAtendimento(c)}
                          disabled={salvandoId === c.id}
                          className="bg-orange-500 hover:bg-orange-600 text-white text-xs px-3 py-2 rounded-lg disabled:opacity-50"
                        >
                          {salvandoId === c.id ? "..." : "👨‍💻 Assumir"}
                        </button>
                      </div>
                    ))}
                </div>
              </div>
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
      <div className="text-sm opacity-75">{label}</div>
    </div>
  );
}
