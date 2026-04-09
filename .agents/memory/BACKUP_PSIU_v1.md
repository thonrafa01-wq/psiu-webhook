# 📦 BACKUP SISTEMA PSIU TELECOM — v1.0
**Data:** 2026-04-09  
**Status:** Sistema funcionando em produção  
**Repositório GitHub:** https://github.com/thonrafa01-wq/psiu-webhook

---

## 🏗️ ARQUITETURA DO SISTEMA

```
WhatsApp do Cliente
        ↓
     Z-API (webhook)
        ↓
  Render.com (server.js)
     ├── Groq (IA: classificação de intenção + transcrição de áudio)
     ├── Receitanet API (dados do cliente, faturas, chamados)
     └── Base44 (banco de dados: ClienteWhatsapp + Atendimento)
```

---

## 🔑 CREDENCIAIS E TOKENS

### Z-API (WhatsApp Gateway)
- Instância: `3F15DC3330DCC11BF2A3BE4FDF68D33E`
- Token: `0BD8484CB7BFF2DAD22E99B5`
- Client-Token: `Fe4e0f41827564db0813cd79b7c5f6e96S`
- URL Base: `https://api.z-api.io/instances/3F15DC3330DCC11BF2A3BE4FDF68D33E/token/0BD8484CB7BFF2DAD22E99B5`
- Login: thomas@psiutelecom.com.br / Hkdsk2388@#7530

### Receitanet
- Token API: `4761052b-1c8c-494a-a4a9-ae60b6b15b2d` *(pode expirar — renovar no painel)*
- URL Base API: `https://sistema.receitanet.net/api/novo/chatbot`
- Endpoints: `/clientes` (POST), `/abertura-chamado` (POST)

### Base44 (banco de dados)
- App ID: `69d55fd1a341508858f11d46`
- API: `https://app.base44.com/api/apps/69d55fd1a341508858f11d46/entities`
- Token: variável `BASE44_SERVICE_TOKEN` (expira periodicamente — renovado automático pelo agente)
- Painel de relatórios: https://untitled-app-f813ec8a.base44.app (senha: `7zvn87C2@`)

### Render.com (hosting)
- Service ID: `srv-d7bgm3p17lss73aitb30`
- API Key: `rnd_Kh5PatJ1TsxMjoCViZVymymWGaSK`
- URL do webhook: `https://psiu-webhook.onrender.com`
- Endpoint: `POST /webhook`

### Groq (IA)
- Modelo LLM: `llama-3.3-70b-versatile`
- Modelo Áudio: `whisper-large-v3-turbo`

### Contatos
- Rafa (dono): `5519999619605`
- Telefone PSIU: `19 3167-2161`

---

## 🗄️ BANCO DE DADOS (Base44)

### Entidade: ClienteWhatsapp
| Campo | Tipo | Descrição |
|---|---|---|
| telefone | string | Número WhatsApp com DDI (5519...) |
| id_cliente_receitanet | string | ID no sistema Receitanet |
| nome | string | Nome completo do cliente |
| cpf_cnpj | string | CPF ou CNPJ |
| identificado | boolean | Se já foi identificado |
| ultimo_contato | string | ISO timestamp do último contato |
| estado_conversa | string | Estado atual do fluxo |

**Estados possíveis (estado_conversa):**
- `aguardando_cpf` — cliente novo, aguardando identificação
- `identificado` — identificado, fluxo normal
- `chamado_aberto` — chamado de suporte aberto
- `cancelamento_retencao` — tentativa de retenção ativa
- `atendente` — encaminhado para humano
- `massiva` — afetado por queda de rede

### Entidade: Atendimento
| Campo | Tipo | Descrição |
|---|---|---|
| telefone | string | Número do cliente |
| nome_cliente | string | Nome do cliente |
| id_cliente_receitanet | string | ID Receitanet |
| motivo | enum | boleto / suporte / cancelamento / menu / outro |
| mensagem_original | string | Mensagem que gerou o atendimento |
| estado_final | enum | resolvido_auto / transferido_humano / em_andamento |
| data_atendimento | string | ISO timestamp |
| resolvido | boolean | Se foi resolvido |

---

## ⚙️ VARIÁVEIS DE AMBIENTE (Render)

```
BASE44_SERVICE_TOKEN=<renovado automaticamente a cada hora>
RECEITANET_CHATBOT_TOKEN=4761052b-1c8c-494a-a4a9-ae60b6b15b2d
GROQ_API_KEY=<na .env do agente>
PORT=3000
```

---

## 🤖 AUTOMAÇÕES ATIVAS (Base44 Superagent)

| Nome | Frequência | Função |
|---|---|---|
| Renovar Token BASE44 no Render | A cada 1h | Atualiza BASE44_SERVICE_TOKEN no Render |
| Fila de Retorno PSIU | A cada 3h | Avisa Rafa sobre atendimentos parados há +3h |
| Relatório Diário PSIU | Todo dia 11h | Resumo do dia via WhatsApp |
| Relatório Resultado Testes | One-time 10/04 | Verificar se sistema está estável |

---

## 📋 FLUXO DO BOT (resumo)

```
1. Z-API recebe mensagem → envia para /webhook no Render
2. Extrair telefone + mensagem + áudio (se houver)
3. Se áudio → transcrever via Groq Whisper
4. Buscar cliente no banco (por telefone com e sem DDI 55)
   ├── ROTA A: cliente com id_receitanet → atender direto
   ├── ROTA B: cliente no banco sem id → tentar pelo telefone no Receitanet
   └── ROTA C: cliente novo → tentar telefone, se falhar pedir CPF
5. Com cliente identificado:
   └── Classificar intenção via Groq LLM
       ├── boleto → buscar faturas no Receitanet → enviar links
       ├── suporte → verificar equipamento → abrir chamado → alertar Rafa
       ├── cancelamento → tentar retenção → alertar Rafa
       └── atendente → avisar horário → alertar Rafa
6. Detectar massiva: se ≥3 chamados de suporte em 30min → modo massiva
```

---

## 📁 ARQUIVOS DO PROJETO

### render_webhook/server.js
Servidor principal com todos os módulos:
- Módulo 1: DB (Base44)
- Módulo 2: Receitanet API
- Módulo 3: Groq (IA + Whisper)
- Módulo 4: Z-API gateway
- Módulo 5: Extração de dados do webhook
- Módulo 6: Estado e utilitários
- Módulo 7: Roteador principal (webhook POST /webhook)
- Módulo 8: Identificação por CPF
- Módulo 9: Orquestrador (cliente identificado)
- Módulo 10: Handlers de intenção (boleto, suporte, cancelamento, retenção, atendente)

### render_webhook/package.json
```json
{
  "name": "psiu-webhook",
  "version": "1.0.0",
  "main": "server.js",
  "scripts": { "start": "node server.js" },
  "dependencies": {
    "express": "^4.18.2",
    "node-fetch": "^2.7.0",
    "form-data": "^4.0.0"
  }
}
```

### .agents/skills/renovar_token_render.sh
Script que atualiza o BASE44_SERVICE_TOKEN no Render via API.

---

## 🔧 WEBHOOK Z-API CONFIGURADO

- URL: `https://psiu-webhook.onrender.com/webhook`
- Eventos: ReceivedCallback, MessageStatusCallback, DeliveryCallback, PresenceChatCallback

---

## ⚠️ PROBLEMAS CONHECIDOS E SOLUÇÕES

### BASE44_SERVICE_TOKEN expira (~4h)
**Solução:** Automação "Renovar Token BASE44 no Render" roda a cada 1h automaticamente.

### Receitanet token expira
**Solução:** Renovar manualmente no painel do Receitanet e atualizar a var `RECEITANET_CHATBOT_TOKEN` no Render.

### Render "spin down" (plano free dorme em 15min)
**Solução:** Atualizar para plano pago no Render ou usar keep-alive externo.

---

## 🚀 COMO FAZER DEPLOY MANUAL

1. Fazer push para o GitHub: `github.com/thonrafa01-wq/psiu-webhook`
2. O Render faz deploy automático via CI/CD
3. Ou acionar via API:
```bash
curl -X POST "https://api.render.com/v1/services/srv-d7bgm3p17lss73aitb30/deploys" \
  -H "Authorization: Bearer rnd_Kh5PatJ1TsxMjoCViZVymymWGaSK" \
  -H "Content-Type: application/json" \
  -d '{"clearCache": "do_not_clear"}'
```

---

## 📊 STATUS NA DATA DO BACKUP
- ✅ Bot recebe mensagens via Z-API
- ✅ Identifica clientes pelo telefone
- ✅ Consulta faturas no Receitanet
- ✅ Abre chamados de suporte
- ✅ Detecta e notifica massiva
- ✅ Transcreve áudio com Groq Whisper
- ✅ Classifica intenção com Groq LLM
- ✅ Alertas via WhatsApp para Rafa
- ✅ Automações de monitoramento ativas
- ⚠️ Token BASE44 precisa de renovação automática (resolvido com automação horária)
