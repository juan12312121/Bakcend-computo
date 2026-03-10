#!/bin/bash

# Script para probar modelos disponibles de Gemini API

# Colores
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${CYAN}========================================"
echo -e "🔍 PROBANDO MODELOS DE GEMINI API"
echo -e "========================================${NC}\n"

# Cargar variables de entorno
if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs)
fi

if [ -z "$GEMINI_API_KEY" ]; then
    echo -e "${RED}❌ ERROR: GEMINI_API_KEY no encontrada${NC}"
    exit 1
fi

echo -e "${GREEN}🔑 API Key: ${GEMINI_API_KEY:0:10}...${NC}\n"

modelos=(
    "gemini-1.5-flash"
    "gemini-1.5-pro"
    "gemini-pro"
    "gemini-2.0-flash-exp"
)

echo -e "${YELLOW}📋 Probando ${#modelos[@]} modelos...${NC}\n"

for modelo in "${modelos[@]}"; do
    echo -n "Probando: $modelo ... "
    
    response=$(curl -s -w "\n%{http_code}" \
        -H "Content-Type: application/json" \
        -H "x-goog-api-key: $GEMINI_API_KEY" \
        -d "{\"contents\":[{\"parts\":[{\"text\":\"test\"}]}],\"generationConfig\":{\"maxOutputTokens\":5}}" \
        "https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent" 2>/dev/null)
    
    http_code=$(echo "$response" | tail -n1)
    
    if [ "$http_code" == "200" ]; then
        echo -e "${GREEN}✅ FUNCIONA${NC}"
    elif [ "$http_code" == "429" ]; then
        echo -e "${YELLOW}⚠️  CUOTA AGOTADA${NC}"
    elif [ "$http_code" == "404" ]; then
        echo -e "${RED}❌ NO EXISTE${NC}"
    else
        echo -e "${RED}❌ ERROR $http_code${NC}"
    fi
    
    sleep 1
done

echo -e "\n${CYAN}========================================${NC}"
