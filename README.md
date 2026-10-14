# 📸 NayBinho Photos

> **Gestor Self-Hosted de Fotos & Vídeos com Inteligência Artificial Local, Mapas e Sincronização Automática Android.**

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-brightgreen.svg)](https://nodejs.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-14%2B-blue.svg)](https://www.postgresql.org/)
[![Android](https://img.shields.io/badge/Android-7.0%2B-green.svg)](https://developer.android.com/)
[![License](https://img.shields.io/badge/license-ISC-blue.svg)](LICENSE)

O **NayBinho Photos** é uma plataforma completa e privativa para armazenamento, organização e visualização de fotos e vídeos pessoais e familiares. Inspirado na experiência imersiva e moderna do Google Photos, funciona de forma 100% independente em sua própria infraestrutura ou servidor local, sem enviar seus dados para serviços de nuvem de terceiros.

---

## ✨ Principais Funcionalidades

### 💻 Interface Web Imersiva (Dark Glassmorphism)
- **Linha do Tempo Inteligente:** Agrupamento automático por datas (*Hoje*, *Ontem*, dias da semana e meses/anos).
- **Visualizador Lightbox Estilo Google Photos:** Barra de status limpa, suporte a atalhos de teclado (`←`, `→`, `ESC`), gestos de deslize no celular e clique para ocultar/exibir controles.
- **Ficha Técnica EXIF:** Detalhes de câmera, modelo, resolução, ISO, velocidade do obturador, tamanho e coordenadas geográficas com link direto para o mapa.
- **Ações Rápidas Flutuantes:** Compartilhamento direto (WhatsApp, redes sociais via Web Share ou Android Intent), favoritar com 1 clique, exclusão segura e download do arquivo original.
- **Tela de Manutenção e Offline Inteligente:** Caso o servidor fique fora do ar ou reinicie, a aplicação exibe uma tela amigável com diagnóstico e reconexão automática suave a cada 5 segundos.

### 📱 Aplicativo Nativo Android
- **Backup Automático em Segundo Plano:** Continua enviando fotos e vídeos automaticamente via `WorkManager`, **mesmo com o aplicativo fechado**.
- **Pastas Monitoradas:** Suporte automático para Câmera (`DCIM/Camera`), Fotos, Vídeos, Downloads e pastas de mídia do **WhatsApp** (`WhatsApp Images`, `WhatsApp Video`).
- **Configuração de Servidor Simplificada:** Conexão por IP local ou domínio externo HTTPS com salvamento seguro de sessão.
- **Instalador APK e Auto-Update:** Distribuição direta do arquivo APK pelo próprio servidor em `/atualizacao/`.

### 📍 Lugares & Mapa Interativo (OpenStreetMap + Leaflet)
- **Pins de Fotos Personalizados:** Cada local com fotos exibe uma miniatura fotográfica no mapa, badge de contagem de fotos (`+N`) e indicador de vídeo.
- **Balão (Popup) com Carrossel:** Ao tocar em um ponto no mapa, abre um card com resumo do endereço geocodificado e faixa deslizante com todas as fotos registradas naquele local.
- **Navegação Contínua por Setas:** Abra qualquer foto do mapa e passe para as próximas e anteriores usando as setas do visualizador ou teclado, sem precisar sair do modo de tela cheia.
- **Geocodificação Reversa Automática:** Integração com OpenStreetMap Nominatim para identificar nome da cidade, bairro, estado e país com base no GPS da foto.
- **Geolocalização Manual do Aparelho:** Botão para vincular a localização atual do celular em fotos que não possuam coordenadas de GPS nativas.

### ❤️ Sistema de Favoritos
- **Marcação Reativa:** Marcador visual em formato de coração vermelho vibrante que atualiza instantaneamente no visualizador e nas grades.
- **Área Exclusiva:** Seção dedicada a todas as fotos marcadas como favoritas para acesso rápido.

### 👤 Reconhecimento Facial Local (IA Privativa)
- **Detecção e Agrupamento de Rostos:** Modelos locais do TensorFlow.js (`face-api.js`), executados 100% no servidor, sem enviar imagens para APIs externas.
- **Gestão de Pessoas:** Identifique e atribua nomes aos rostos detectados para encontrar rapidamente todas as lembranças de uma pessoa.

### 🗂️ Álbuns, Galerias e Multi-usuário
- **Álbuns Customizados:** Crie coleções temáticas (Viagens, Aniversários, Família).
- **Isolamento Total por Usuário:** Cada conta possui sua própria pasta UUID em disco e controle rigoroso de acesso.
- **Painel de Usuários & Cotas:** Administrador pode criar usuários e definir limites de armazenamento em disco.
- **Streaming de Vídeo Fluido:** Suporte a cabeçalhos `HTTP Range` para reprodução instantânea com avanço/retrocesso sem travar.

---

## 🌐 Acessos Rápidos

| Serviço | URL | Descrição |
|---|---|---|
| **Interface Web** | [http://localhost:9453](http://localhost:9453) | Aplicação web principal |
| **Documentação Swagger** | [http://localhost:9453/api/docs](http://localhost:9453/api/docs) | Swagger UI com todos os endpoints |
| **Healthcheck** | [http://localhost:9453/api/health](http://localhost:9453/api/health) | Diagnóstico e status da API |
| **Download do APK** | [http://localhost:9453/atualizacao/NayBinho-Photos.apk](http://localhost:9453/atualizacao/NayBinho-Photos.apk) | Instalador do aplicativo Android |

---

## 📁 Estrutura de Pastas

```
Photos/
├── apk/                    # Projeto Android nativo (Android Studio / Kotlin / Gradle)
│   ├── app/                # Código-fonte do app (BackupWorker, MainActivity, WebView)
│   └── build_apk.ps1       # Script PowerShell para gerar o APK
├── atualizacao/            # Distribuição do APK e controle de versões (version.json)
├── docs/                   # Documentação aprofundada do sistema
│   ├── ARCHITECTURE.md     # Arquitetura e decisões técnicas
│   ├── API.md              # Referência completa de rotas e payloads
│   ├── ANDROID.md          # Guia do aplicativo móvel e background sync
│   └── DEPLOYMENT.md       # Guia de implantação em produção (Linux/Windows/Docker)
├── models/                 # Modelos pré-treinados de IA para face-api.js
├── public/                 # Interface Web Frontend (SPA)
│   ├── index.html          # Código completo da interface web
│   ├── logo.jpg            # Logotipo oficial NayBinho
│   └── icon.jpg            # Ícone do aplicativo
├── src/                    # Backend Node.js + Express
│   ├── config/             # Configurações de banco de dados (Sequelize)
│   ├── controllers/        # Controladores de rotas
│   ├── middleware/         # Autenticação JWT, upload Multer, tratamento de erros
│   ├── models/             # Modelos Sequelize (User, Media, Album, Location, Face)
│   ├── routes/             # Rotas REST da API
│   ├── services/           # Serviços de sincronização, geocodificação e IA
│   └── utils/              # Processamento de imagens, thumbnails e EXIF
└── storage/                # Armazenamento físico de mídias por usuário
```

---

## 🚀 Instalação e Execução

### Opção A: Via Docker Compose (Recomendado para Servidores)

Se você já possui um servidor com Docker e o banco PostgreSQL rodando separadamente:

1. Baixe o [docker-compose.yml](file:///c:/Users/Douglas/Documents/Apps/Photos/docker-compose.yml) e configure as variáveis do seu banco de dados no arquivo `.env`:
   ```env
   DB_HOST=192.168.1.100       # Endereço do seu PostgreSQL
   DB_PORT=5432
   DB_NAME=photovault
   DB_USER=postgres
   DB_PASSWORD=sua_senha
   JWT_SECRET=chave_secreta_jwt_longa
   ```
2. Inicie o container com a imagem oficial do Docker Hub:
   ```bash
   docker compose pull
   docker compose up -d
   ```
3. Acesse em: **`http://seu-servidor:9453`**

---

### Opção B: Instalação Manual Direta (Node.js)

#### Pré-requisitos
- **Node.js** 18.x ou superior
- **PostgreSQL** 14.x ou superior
- **FFmpeg** instalado no sistema (opcional, para geração de thumbnails de vídeo)

#### 1. Clonar e Instalar Dependências
```bash
git clone <url-do-repositorio>
cd Photos
npm install
```

### 2. Configurar Variáveis de Ambiente
Crie ou edite o arquivo `.env` na raiz do projeto:
```env
PORT=9453
NODE_ENV=development

# Banco de Dados PostgreSQL
DB_HOST=localhost
DB_PORT=5432
DB_NAME=photovault
DB_USER=postgres
DB_PASSWORD=sua_senha_aqui

# Autenticação JWT
JWT_SECRET=sua_chave_secreta_jwt_longa_e_aleatoria
JWT_EXPIRES_IN=30d

# Armazenamento
STORAGE_PATH=./storage
MAX_FILE_SIZE_MB=500

# Miniaturas
THUMBNAIL_WIDTH=400
THUMBNAIL_HEIGHT=400
```

### 3. Criar o Banco de Dados
No PostgreSQL:
```sql
CREATE DATABASE photovault;
```

### 4. Iniciar o Servidor

```bash
# Modo de desenvolvimento (reinício automático ao editar arquivos)
npm run dev

# Modo de produção
npm start
```

O servidor estará disponível em: **`http://localhost:9453`**

---

## 🔑 Primeiro Acesso (Configuração Inicial)

1. Ao abrir [http://localhost:9453](http://localhost:9453) pela primeira vez, o assistente de primeiro uso guiará a criação da conta de **Administrador**.
2. A conta de Administrador tem permissão para:
   - Gerenciar outros usuários e senhas;
   - Monitorar o consumo de disco individual e geral;
   - Ativar e rodar a geocodificação em massa de fotos com GPS;
   - Visualizar logs e configurações do sistema.

---

## 📚 Documentação Adicional

Acesse a documentação detalhada na pasta [`docs/`](file:///c:/Users/Douglas/Documents/Apps/Photos/docs):

- 🏛️ [**Arquitetura do Sistema**](file:///c:/Users/Douglas/Documents/Apps/Photos/docs/ARCHITECTURE.md) — Diagrama de componentes, fluxo de dados e decisões de design.
- 📡 [**Referência da API REST**](file:///c:/Users/Douglas/Documents/Apps/Photos/docs/API.md) — Documentação técnica completa de todos os endpoints e modelos.
- 📱 [**Guia do Aplicativo Android**](file:///c:/Users/Douglas/Documents/Apps/Photos/docs/ANDROID.md) — Como funciona o backup em segundo plano, compilação de APK e permissões.
- 🚀 [**Guia de Implantação em Produção**](file:///c:/Users/Douglas/Documents/Apps/Photos/docs/DEPLOYMENT.md) — Setup com Nginx, SSL/HTTPS, PM2 e rotinas de backup.

---

## 📄 Licença

Este projeto é disponibilizado sob a licença [ISC](LICENSE).
