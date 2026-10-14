# 📡 Referência Completa da API REST

A API do **NayBinho Photos** utiliza convenções REST padrão, com payloads e respostas em JSON.
A documentação interativa também está disponível via Swagger UI no endpoint [`/api/docs`](http://localhost:9453/api/docs).

---

## 🌐 Endpoints Gerais

### Healthcheck
```http
GET /api/health
```
Retorna o status geral da aplicação, conectividade com o banco de dados e uso de memória.

**Resposta `200 OK`:**
```json
{
  "status": "healthy",
  "uptime": 3600.25,
  "database": "connected",
  "version": "1.0.0"
}
```

---

## 🔐 Autenticação (`/api/auth`)

### Verificar Status do Setup Inicial
```http
GET /api/auth/setup-status
```
Retorna se já existe uma conta de administrador criada.

### Criar Administrador (Primeiro Acesso)
```http
POST /api/auth/setup
Content-Type: application/json
```
```json
{
  "username": "admin",
  "email": "admin@exemplo.com",
  "password": "SenhaSegura123!",
  "display_name": "Administrador"
}
```

### Login
```http
POST /api/auth/login
Content-Type: application/json
```
```json
{
  "username": "admin",
  "password": "SenhaSegura123!"
}
```
**Resposta `200 OK`:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "9c1ed730-b689-430a-931c-516e84df4a49",
    "username": "admin",
    "display_name": "Administrador",
    "is_admin": true
  }
}
```

### Dados do Usuário Logado
```http
GET /api/auth/me
Authorization: Bearer <token>
```

---

## 📸 Mídia — Fotos & Vídeos (`/api/media`)

### Upload de Arquivos
```http
POST /api/media/upload
Authorization: Bearer <token>
Content-Type: multipart/form-data
```
**Campos do Formulário:**
- `files`: Arquivos de imagem ou vídeo (múltiplos permitidos).
- `location_id` *(opcional)*: ID de um local cadastrado.

**Resposta `201 Created`:**
```json
{
  "message": "Upload concluído",
  "uploaded": [
    {
      "id": "3549a709-1238-4c7e-a57d-ebd53562e4b9",
      "original_filename": "20261012_231557.jpg",
      "media_type": "photo",
      "mime_type": "image/jpeg",
      "file_size_bytes": 4528192,
      "width": 4032,
      "height": 3024,
      "latitude": -19.81442,
      "longitude": -44.020836,
      "is_favorite": false
    }
  ]
}
```

### Listar Mídias
```http
GET /api/media?page=1&limit=50&media_type=photo&is_favorite=true&search=termo
Authorization: Bearer <token>
```
**Parâmetros de Query:**
- `page` *(int)*: Página (padrão: `1`).
- `limit` *(int ou "all")*: Quantidade por página (padrão: `50`).
- `media_type` *(string)*: `photo` ou `video`.
- `is_favorite` *(boolean)*: Filtrar por favoritos (`true` ou `false`).
- `from_date` / `to_date` *(ISO Date)*: Filtrar por intervalo de data.
- `order_by` *(string)*: Campo de ordenação (`taken_at`, `createdAt`).
- `order_dir` *(string)*: `ASC` ou `DESC`.

### Obter Detalhes da Mídia
```http
GET /api/media/:id
Authorization: Bearer <token>
```

### Obter Imagem/Vídeo Original (Streaming)
```http
GET /api/media/:id/file?token=<token_opcional>
Authorization: Bearer <token>
```
Suporta cabeçalhos HTTP `Range` para vídeos.

### Obter Miniatura (Thumbnail)
```http
GET /api/media/:id/thumbnail?token=<token_opcional>
Authorization: Bearer <token>
```

### Download com Forçamento de Nome
```http
GET /api/media/:id/download?token=<token_opcional>
Authorization: Bearer <token>
```

### Atualizar Metadados / Favoritar
```http
PATCH /api/media/:id
Authorization: Bearer <token>
Content-Type: application/json
```
```json
{
  "is_favorite": true,
  "title": "Minha Foto na Praia",
  "latitude": -19.81442,
  "longitude": -44.020836
}
```

### Excluir Mídia
```http
DELETE /api/media/:id
Authorization: Bearer <token>
```

### Exclusão em Massa
```http
POST /api/media/bulk-delete
Authorization: Bearer <token>
Content-Type: application/json
```
```json
{
  "media_ids": ["uuid-1", "uuid-2"]
}
```

### Geocodificar Fotos com GPS Existentes
```http
POST /api/media/geocode-existing
Authorization: Bearer <token>
```
Localiza no banco todas as fotos que possuem latitude e longitude mas ainda não foram vinculadas a um local, processando a geocodificação reversa em segundo plano via OpenStreetMap.

---

## 📍 Lugares & Geolocalização (`/api/locations`)

### Listar Locais com Fotos
```http
GET /api/locations
Authorization: Bearer <token>
```
**Resposta `200 OK`:**
```json
{
  "total": 1,
  "locations": [
    {
      "id": "45abd5d4-d375-4710-a782-f0892218f055",
      "name": "Ribeirão das Neves",
      "latitude": -19.81442,
      "longitude": -44.020836,
      "city": "Ribeirão das Neves",
      "state": "Minas Gerais",
      "country": "Brasil",
      "country_code": "br",
      "full_address": "Rua Exemplo, Bairro, Ribeirão das Neves - MG",
      "media": [
        {
          "id": "3549a709-1238-4c7e-a57d-ebd53562e4b9",
          "media_type": "photo",
          "is_favorite": true
        }
      ]
    }
  ]
}
```

### Buscar Locais Próximos (Raio Haversine)
```http
GET /api/locations/nearby?lat=-19.814&lng=-44.020&radius_km=10
Authorization: Bearer <token>
```

---

## 🗂️ Álbuns (`/api/albums`)

### Listar Álbuns
```http
GET /api/albums
Authorization: Bearer <token>
```

### Criar Álbum
```http
POST /api/albums
Authorization: Bearer <token>
Content-Type: application/json
```
```json
{
  "title": "Viagem de Férias",
  "description": "Fotos da viagem"
}
```

### Adicionar Fotos ao Álbum
```http
POST /api/albums/:id/media
Authorization: Bearer <token>
Content-Type: application/json
```
```json
{
  "media_ids": ["uuid-1", "uuid-2"]
}
```

---

## 👤 Reconhecimento Facial (`/api/faces`)

### Status dos Modelos de IA
```http
GET /api/faces/status
Authorization: Bearer <token>
```

### Analisar Faces de uma Foto Específica
```http
POST /api/faces/analyze/:mediaId
Authorization: Bearer <token>
```

### Analisar Todas as Fotos Pendentes
```http
POST /api/faces/analyze-all
Authorization: Bearer <token>
```

### Listar Pessoas Reconhecidas
```http
GET /api/faces/persons
Authorization: Bearer <token>
```

---

## 👥 Gerenciamento de Usuários (`/api/users`) - Apenas Admin

### Listar Usuários
```http
GET /api/users
Authorization: Bearer <admin_token>
```

### Criar Novo Usuário
```http
POST /api/users
Authorization: Bearer <admin_token>
Content-Type: application/json
```
```json
{
  "username": "douglas",
  "email": "douglas@exemplo.com",
  "password": "SenhaSegura123!",
  "display_name": "Douglas Valeriano",
  "max_storage_bytes": 10737418240
}
```

### Editar Usuário (Nome, E-mail, Senha, Cota, Perfil ou Status)
```http
PATCH /api/users/:id
Authorization: Bearer <admin_token>
Content-Type: application/json
```
```json
{
  "display_name": "Douglas Valeriano Geraldo de Souza",
  "email": "douglas@exemplo.com",
  "password": "NovaSenhaSegura123!",
  "is_admin": true,
  "is_active": true,
  "max_storage_bytes": 21474836480
}
```

### Excluir Usuário (com opção de apagar pasta física)
```http
DELETE /api/users/:id?delete_files=true
Authorization: Bearer <admin_token>
```
**Parâmetros de Query / Body:**
- `delete_files` *(boolean)*:
  - `false` (padrão): Exclui a conta do sistema, mantendo os arquivos e pasta física em disco (`storage/<pasta>`).
  - `true`: Exclui a conta e **apaga permanentemente a pasta física e todas as fotos/vídeos do disco**.

**Resposta `200 OK`:**
```json
{
  "message": "Usuário e todos os arquivos em disco foram excluídos permanentemente.",
  "deleted_files": true
}
```
