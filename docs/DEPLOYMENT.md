# 🚀 Guia de Implantação e Produção

Este guia explica como hospedar e manter o **NayBinho Photos** em ambiente de produção (servidor dedicado, VPS ou computador doméstico sempre ligado).

---

## 🐳 Opção 1: Executando com Docker Compose (Servidor com PostgreSQL Externo)

A forma mais simples e robusta de rodar o **NayBinho Photos** em um servidor é utilizando a imagem oficial disponibilizada no Docker Hub: `naybinho/naybinho-photos:latest`.

Como você já possui o banco **PostgreSQL** em um servidor à parte (ou rodando nativamente no host), o `docker-compose.yml` inclui apenas a aplicação, conectando-se diretamente ao seu banco existente.

### 1. Arquivos Necessários no Servidor
Basta criar uma pasta no seu servidor (ex: `/opt/naybinho-photos`) contendo dois arquivos:
1. `docker-compose.yml`
2. `.env`

#### Exemplo de `.env` para o Docker:
```env
# Porta da aplicação web
PORT=9453
NODE_ENV=production

# Conexão com seu servidor PostgreSQL externo
DB_HOST=192.168.1.100       # IP ou domínio do seu servidor PostgreSQL (use host.docker.internal se estiver no mesmo host)
DB_PORT=5432
DB_NAME=photovault
DB_USER=postgres
DB_PASSWORD=sua_senha_do_postgres

# Segurança JWT
JWT_SECRET=gere_uma_chave_longa_e_segura_aqui_para_producao
JWT_EXPIRES_IN=30d

# Armazenamento e Limites
MAX_FILE_SIZE_MB=500
```

> 💡 **Nota sobre host local:** Se o PostgreSQL estiver rodando diretamente no mesmo servidor host fora do Docker, use `DB_HOST=host.docker.internal`.

### 2. Baixar a Imagem e Iniciar o Container
```bash
# Baixar a versão mais recente do Docker Hub
docker compose pull

# Iniciar em segundo plano (detached)
docker compose up -d

# Visualizar logs em tempo real
docker compose logs -f app
```

### 3. Comandos Úteis do Docker Compose
```bash
docker compose ps             # Status do container
docker compose restart app    # Reiniciar o serviço
docker compose stop           # Parar sem remover dados
docker compose pull && docker compose up -d  # Atualizar para versão mais nova
```

---

## 🖥️ Opção 2: Executando com PM2 (Node.js Process Manager)

O PM2 mantém a aplicação rodando 24/7, reiniciando o serviço em caso de falha e iniciando automaticamente junto com o sistema operacional.

### 1. Instalar o PM2 Globalmente
```bash
npm install -g pm2
```

### 2. Iniciar o Servidor
```bash
# Na pasta raiz do projeto
pm2 start src/server.js --name "naybinho-photos"
```

### 3. Configurar Inicialização Automática no Boot
```bash
pm2 save
pm2 startup
```

### 4. Comandos Úteis do PM2
```bash
pm2 status                  # Ver status e consumo de CPU/Memória
pm2 logs naybinho-photos    # Ver logs em tempo real
pm2 restart naybinho-photos # Reiniciar servidor
pm2 stop naybinho-photos    # Parar temporariamente
```

---

## 🌐 Opção 3: Configuração de Proxy Reverso com Nginx & SSL

Para acessar com um domínio próprio seguro (`https://fotos.meudominio.com`):

### Exemplo de Configuração Nginx (`/etc/nginx/sites-available/photos`):
```nginx
server {
    listen 80;
    server_name fotos.meudominio.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name fotos.meudominio.com;

    # Certificados SSL (ex: Let's Encrypt Certbot)
    ssl_certificate /etc/letsencrypt/live/fotos.meudominio.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/fotos.meudominio.com/privkey.pem;

    # Permitir uploads grandes de fotos e vídeos em 4K
    client_max_body_size 500M;

    location / {
        proxy_pass http://127.0.0.1:9453;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
```

---

## 💾 Estratégia de Backup dos Dados

Para garantir a segurança das suas memórias, faça backup regular de dois componentes:

### 1. Banco de Dados PostgreSQL
Execute via script cron diário:
```bash
pg_dump -U postgres -h localhost photovault > /caminho/do/backup/photovault_$(date +%F).sql
```

### 2. Pasta de Arquivos (`storage/`)
A pasta `storage/` contém os arquivos originais e miniaturas de cada usuário.
Pode ser sincronizada usando `rsync` ou ferramenta de sincronização em nuvem:
```bash
rsync -avz --delete /caminho/do/Photos/storage/ /disco_externo/backup_photos/
```

---

## ⚙️ Variáveis de Ambiente Recomendadas para Produção

No seu arquivo `.env`:
```env
NODE_ENV=production
PORT=9453

# Banco de Dados
DB_HOST=localhost
DB_PORT=5432
DB_NAME=photovault
DB_USER=postgres
DB_PASSWORD=sua_senha_forte_producao

# JWT Seguro
JWT_SECRET=gere_uma_chave_aleatoria_com_openssl_rand_hex_64
JWT_EXPIRES_IN=60d

# Armazenamento e Limites
STORAGE_PATH=./storage
MAX_FILE_SIZE_MB=500
```
