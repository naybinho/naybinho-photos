const router = require('express').Router();
const swaggerUi = require('swagger-ui-express');
const path = require('path');
const fs = require('fs');

const swaggerDoc = {
  openapi: '3.0.0',
  info: {
    title: 'PhotoVault API',
    version: '1.0.0',
    description: 'API REST para sistema de gerenciamento de fotos e vídeos com reconhecimento facial',
    contact: { name: 'PhotoVault Support' },
  },
  servers: [
    { url: `http://localhost:${process.env.PORT || 3000}`, description: 'Local Development' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
    },
  },
  security: [{ bearerAuth: [] }],
  tags: [
    { name: 'Auth', description: 'Autenticação e gerenciamento de sessão' },
    { name: 'Users', description: 'Gerenciamento de usuários (admin)' },
    { name: 'Media', description: 'Upload e gerenciamento de fotos e vídeos' },
    { name: 'Albums', description: 'Álbuns (coleções de mídias)' },
    { name: 'Galleries', description: 'Galerias (agrupamentos por evento/data)' },
    { name: 'Locations', description: 'Locais e geolocalização' },
    { name: 'Faces', description: 'Reconhecimento facial' },
  ],
  paths: {
    '/api/auth/setup-status': {
      get: {
        tags: ['Auth'],
        summary: 'Verificar status de configuração inicial',
        security: [],
        responses: { 200: { description: 'Status retornado' } },
      },
    },
    '/api/auth/setup': {
      post: {
        tags: ['Auth'],
        summary: 'Criar usuário administrador (primeira execução)',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['username', 'email', 'password'],
                properties: {
                  username: { type: 'string', example: 'admin' },
                  email: { type: 'string', example: 'admin@example.com' },
                  password: { type: 'string', minLength: 8, example: 'senha123!' },
                  display_name: { type: 'string', example: 'Administrador' },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Admin criado com sucesso' },
          403: { description: 'Setup já foi realizado' },
        },
      },
    },
    '/api/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Login',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['username', 'password'],
                properties: {
                  username: { type: 'string', description: 'Username ou email' },
                  password: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Token JWT retornado' }, 401: { description: 'Credenciais inválidas' } },
      },
    },
    '/api/auth/me': {
      get: { tags: ['Auth'], summary: 'Dados do usuário logado', responses: { 200: { description: 'Dados do usuário' } } },
    },
    '/api/auth/change-password': {
      post: {
        tags: ['Auth'],
        summary: 'Alterar senha',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['current_password', 'new_password'],
                properties: {
                  current_password: { type: 'string' },
                  new_password: { type: 'string', minLength: 8 },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Senha alterada' } },
      },
    },
    '/api/users': {
      get: { tags: ['Users'], summary: 'Listar usuários (admin)', parameters: [{ name: 'page', in: 'query', schema: { type: 'integer' } }, { name: 'limit', in: 'query', schema: { type: 'integer' } }], responses: { 200: { description: 'Lista de usuários' } } },
      post: {
        tags: ['Users'],
        summary: 'Criar usuário (admin)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['username', 'email', 'password'],
                properties: {
                  username: { type: 'string' },
                  email: { type: 'string' },
                  password: { type: 'string' },
                  display_name: { type: 'string' },
                  is_admin: { type: 'boolean' },
                },
              },
            },
          },
        },
        responses: { 201: { description: 'Usuário criado' } },
      },
    },
    '/api/media/upload': {
      post: {
        tags: ['Media'],
        summary: 'Upload de fotos/vídeos (múltiplos arquivos)',
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                properties: {
                  files: { type: 'array', items: { type: 'string', format: 'binary' } },
                  gallery_id: { type: 'string', format: 'uuid' },
                  album_id: { type: 'string', format: 'uuid' },
                  description: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { 201: { description: 'Arquivos enviados com sucesso' } },
      },
    },
    '/api/media': {
      get: {
        tags: ['Media'],
        summary: 'Listar mídias com filtros',
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer' } },
          { name: 'limit', in: 'query', schema: { type: 'integer' } },
          { name: 'media_type', in: 'query', schema: { type: 'string', enum: ['photo', 'video'] } },
          { name: 'gallery_id', in: 'query', schema: { type: 'string', format: 'uuid' } },
          { name: 'album_id', in: 'query', schema: { type: 'string', format: 'uuid' } },
          { name: 'is_favorite', in: 'query', schema: { type: 'boolean' } },
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'from_date', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'to_date', in: 'query', schema: { type: 'string', format: 'date' } },
        ],
        responses: { 200: { description: 'Lista de mídias' } },
      },
    },
    '/api/media/{id}/file': {
      get: { tags: ['Media'], summary: 'Stream do arquivo original (suporta Range para vídeos)', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Arquivo de mídia' } } },
    },
    '/api/media/{id}/thumbnail': {
      get: { tags: ['Media'], summary: 'Thumbnail da mídia', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Imagem JPEG do thumbnail' } } },
    },
    '/api/faces/status': {
      get: { tags: ['Faces'], summary: 'Status do reconhecimento facial', responses: { 200: { description: 'Status dos modelos de IA' } } },
    },
    '/api/faces/analyze/{mediaId}': {
      post: { tags: ['Faces'], summary: 'Analisar faces em uma foto', parameters: [{ name: 'mediaId', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Faces detectadas' } } },
    },
    '/api/faces/analyze-all': {
      post: { tags: ['Faces'], summary: 'Analisar todas as fotos não processadas (background)', responses: { 200: { description: 'Job iniciado em background' } } },
    },
    '/api/faces/persons': {
      get: { tags: ['Faces'], summary: 'Listar pessoas cadastradas', responses: { 200: { description: 'Lista de pessoas' } } },
      post: {
        tags: ['Faces'],
        summary: 'Cadastrar nova pessoa',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, description: { type: 'string' } } } } } },
        responses: { 201: { description: 'Pessoa criada' } },
      },
    },
  },
};

router.use('/', swaggerUi.serve);
router.get('/', swaggerUi.setup(swaggerDoc, {
  customSiteTitle: 'PhotoVault API Docs',
  customCss: '.swagger-ui .topbar { background-color: #1a1a2e; } .swagger-ui .topbar-wrapper img { display: none; } .swagger-ui .topbar-wrapper::before { content: "📸 PhotoVault API"; color: white; font-size: 1.5em; font-weight: bold; }',
}));

module.exports = router;
