#!/bin/bash
# Renova o BASE44_SERVICE_TOKEN no Render
# Chamado pela automação a cada 2 horas

source /app/.agents/.env

echo "[TOKEN] Buscando token atual..."

# O token é gerado dinamicamente pelo ambiente da Base44
# Vamos pegar o token atual do ambiente e atualizar no Render

TOKEN="$BASE44_SERVICE_TOKEN"

if [ -z "$TOKEN" ]; then
  echo "[ERRO] BASE44_SERVICE_TOKEN não encontrado no ambiente"
  exit 1
fi

# Verificar expiração
EXP=$(echo "$TOKEN" | cut -d'.' -f2 | python3 -c "
import sys, base64, json
payload = sys.stdin.read().strip()
payload += '=' * (4 - len(payload) % 4)
try:
    decoded = json.loads(base64.b64decode(payload).decode())
    print(decoded.get('exp', 0))
except:
    print(0)
")

NOW=$(date +%s)
DIFF=$((EXP - NOW))

echo "[TOKEN] Expira em: ${DIFF}s ($(( DIFF / 60 )) minutos)"

# Atualizar no Render
RESULT=$(curl -s -X PUT "https://api.render.com/v1/services/srv-d7bgm3p17lss73aitb30/env-vars" \
  -H "Authorization: Bearer $RENDER_API_KEY" \
  -H "Content-Type: application/json" \
  -d "[
    {\"key\": \"BASE44_SERVICE_TOKEN\", \"value\": \"$TOKEN\"},
    {\"key\": \"RECEITANET_CHATBOT_TOKEN\", \"value\": \"$RECEITANET_CHATBOT_TOKEN\"},
    {\"key\": \"GROQ_API_KEY\", \"value\": \"$GROQ_API_KEY\"}
  ]")

echo "[RENDER] Resposta: $(echo $RESULT | head -c 100)"

# Forçar redeploy apenas se token estiver perto de expirar (menos de 3 horas)
if [ "$DIFF" -lt 10800 ]; then
  echo "[RENDER] Token expira em menos de 3h — forçando redeploy..."
  DEPLOY=$(curl -s -X POST "https://api.render.com/v1/services/srv-d7bgm3p17lss73aitb30/deploys" \
    -H "Authorization: Bearer $RENDER_API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"clearCache\": \"do_not_clear\"}")
  echo "[RENDER] Deploy: $(echo $DEPLOY | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('deploy',{}).get('status','?'))" 2>/dev/null)"
fi

echo "[TOKEN] Concluído"
