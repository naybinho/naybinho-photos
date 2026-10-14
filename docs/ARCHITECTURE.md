# 🏛️ Arquitetura do NayBinho Photos

Este documento descreve a arquitetura geral do **NayBinho Photos**, abrangendo seus componentes de backend, interface web (frontend), aplicativo móvel Android, processamento de mídia e integração de mapas.

---

## 📐 Visão Geral da Arquitetura

```mermaid
flowchart TD
    subgraph Clientes ["Camada de Clientes"]
        Web["Navegador Web / PWA (Dark Glassmorphism SPA)"]
        AndroidApp["App Android Nativo (Kotlin + WebView)"]
        AndroidSync["Android Background Worker (WorkManager)"]
    end

    subgraph Entrada ["Camada de Entrada / Servidor"]
        Nginx["Proxy Reverso (Opcional Nginx / SSL)"]
        ExpressApp["API Server (Node.js + Express :9453)"]
    end

    subgraph Seguranca ["Middleware & Segurança"]
        JWT["Autenticação JWT"]
        RateLimit["Rate Limiter & Helmet"]
        MulterUpload["Multer File Stream Handler"]
    end

    subgraph Processamento ["Pipelines de Mídia & Inteligência"]
        SharpLib["Sharp (Thumbnails & Otimização de Imagens)"]
        FFmpegLib["FFmpeg (Thumbnails & Metadados de Vídeos)"]
        ExifParser["Extração de EXIF & GPS"]
        OSMGeo["Nominatim Geocoder (OpenStreetMap)"]
        FaceAI["TensorFlow.js / face-api.js (IA Local)"]
    end

    subgraph Persistencia ["Camada de Persistência"]
        PostgresDB[(PostgreSQL 14+)]
        FileSystem["Armazenamento em Disco Isolado (/storage/{uuid})"]
    end

    Web -->|HTTP / REST| ExpressApp
    AndroidApp -->|HTTP / REST| ExpressApp
    AndroidSync -->|Multipart Upload| ExpressApp

    ExpressApp --> Seguranca
    Seguranca --> Processamento
    ExpressApp --> PostgresDB
    Processamento --> FileSystem
    Processamento --> OSMGeo
    Processamento --> PostgresDB
```

---

## 🧩 Componentes Principais

### 1. Servidor Backend (`src/`)
- **Runtime:** Node.js (CommonJS) sobre Express.
- **ORM:** Sequelize gerenciando PostgreSQL com migrações automáticas de schema (`alter: true` em ambiente seguro).
- **Controle de Mídia:**
  - Extração imediata de dados EXIF (data tirada, câmera, lente, abertura, coordenadas GPS).
  - Geração assíncrona de miniaturas (thumbnails em WebP/JPEG) com `sharp` para imagens e `@ffmpeg-installer/ffmpeg` para vídeos.
  - Streaming eficiente de arquivos com suporte a `Range Requests` (código HTTP `206 Partial Content`), permitindo avançar e retroceder vídeos sem baixar o arquivo inteiro.
- **Geocodificação Reversa (OpenStreetMap):**
  - As coordenadas extraídas das fotos (`latitude` e `longitude`) são consultadas no serviço OpenStreetMap Nominatim com cache local para evitar requisições redundantes e respeitar limites de taxa.
  - Vinculação com o modelo `Location` agrupando fotos do mesmo bairro/cidade.

### 2. Interface Web Frontend (`public/`)
- **Filosofia:** Single Page Application (SPA) construída com Vanilla HTML5, CSS3 moderno (Dark Glassmorphism) e JavaScript ES6+.
- **Desempenho:** Carregamento instantâneo sem frameworks pesados, sem build step obrigatório.
- **Bibliotecas Embutidas:**
  - **Leaflet.js:** Renderização interativa de mapas de calor e marcadores OpenStreetMap com tiles escuros (*CartoDB Dark Matter*) e claros (*OpenStreetMap Standard*).
  - **Lucide Icons:** Biblioteca de ícones SVG limpos e modernos.
- **Resiliência a Falhas:**
  - Monitoramento contínuo de conectividade (`fetch` com timeout).
  - Tela de manutenção automática em caso de queda de servidor, com reconexão reativa sem perda do estado de navegação.

### 3. Aplicativo Móvel Android (`apk/`)
- **Linguagem & Plataforma:** Kotlin nativo, Android SDK 24+ (Android 7.0 até Android 14+).
- **Interface:** Shell nativo com `WebView` imersiva com suporte a aceleração de hardware.
- **Sincronização em Segundo Plano (Background Worker):**
  - Implementado utilizando `androidx.work.WorkManager`.
  - Agendamento periódico (`PeriodicWorkRequest`) com verificação de novas fotos em pastas do sistema.
  - Continua monitorando e fazendo upload de fotos e vídeos mesmo quando o aplicativo é fechado pelo usuário ou o aparelho é reiniciado (`BOOT_COMPLETED`).
  - Suporta pastas da Câmera, Galeria e pastas do WhatsApp (`WhatsApp Images` e `WhatsApp Video`).

---

## 🗄️ Modelo de Dados (PostgreSQL)

```mermaid
erDiagram
    USERS ||--o{ MEDIA : "possui"
    USERS ||--o{ ALBUMS : "cria"
    USERS ||--o{ LOCATIONS : "possui"
    USERS ||--o{ PERSONS : "possui"

    LOCATIONS ||--o{ MEDIA : "contém"
    ALBUMS ||--o{ ALBUM_MEDIA : "associa"
    MEDIA ||--o{ ALBUM_MEDIA : "pertence"

    MEDIA ||--o{ FACE_DETECTIONS : "contém"
    PERSONS ||--o{ FACE_DETECTIONS : "identifica"

    USERS {
        uuid id PK
        string username
        string email
        string password_hash
        string display_name
        boolean is_admin
        string storage_folder
        bigint storage_used_bytes
        bigint max_storage_bytes
    }

    MEDIA {
        uuid id PK
        uuid user_id FK
        uuid location_id FK
        string original_filename
        string stored_filename
        string file_path
        string thumbnail_path
        string mime_type
        enum media_type
        bigint file_size_bytes
        int width
        int height
        float duration_seconds
        timestamp taken_at
        string camera_make
        string camera_model
        decimal latitude
        decimal longitude
        boolean is_favorite
        boolean is_public
    }

    LOCATIONS {
        uuid id PK
        uuid user_id FK
        string name
        decimal latitude
        decimal longitude
        string city
        string state
        string country
        string full_address
    }

    ALBUMS {
        uuid id PK
        uuid user_id FK
        string title
        text description
        uuid cover_media_id
    }

    PERSONS {
        uuid id PK
        uuid user_id FK
        string name
    }

    FACE_DETECTIONS {
        uuid id PK
        uuid media_id FK
        uuid person_id FK
        json bounding_box
        float confidence
    }
```

---

## 🔒 Princípios de Segurança e Isolamento

1. **Autenticação:** Baseada em tokens JWT criptografados com HMAC-SHA256 e expiração configurável.
2. **Isolamento em Disco:** Cada usuário possui um identificador único (`storage_folder` baseado no seu usuário/UUID). Nenhuma requisição permite navegação de diretórios (`path traversal`) para fora de sua própria pasta.
3. **Senhas Seguras:** Hashing com `bcrypt` com custo de trabalho (salt rounds) 12.
4. **Proteção de Cabeçalhos:** Middleware `helmet` aplicado em todas as rotas HTTP.
5. **Controle de Cota de Disco:** Cada upload decrementa a cota disponível do usuário; ao atingir o limite configurado, novos uploads são rejeitados de forma segura.
